#!/usr/bin/env python3
"""Read-only stock graph/identifier query inside the existing scientific API runtime.
Invoked with fixed argv and JSON stdin, never credentials or SQL from the caller.
"""
import json, sys
import psycopg
from app.config import settings

ID_CONDITION = "(m.metadata->>'ID' = %s OR m.metadata->>'MAIN_BAS' = %s OR m.metadata->>'compound_id' = %s)"

def counters(cur):
    cur.execute("SELECT n_tup_ins, n_tup_upd, n_tup_del FROM pg_stat_user_tables WHERE relid='public.molecules'::regclass")
    inserted, updated, deleted = cur.fetchone()
    return {'inserted': inserted, 'updated': updated, 'deleted': deleted}

def fingerprint(cur, dataset, write_counters=None):
    """Cheap change detector for the identifier lookup built by stock_ids.py.
    Row count/min/max catch inserts and deletes in this dataset; the table's
    cumulative write counters catch any update (or a stats reset) anywhere in it.
    Counters are flushed about a second after a commit, so an identifier renamed
    in place can be missed for that long; stock imports add new datasets instead."""
    cur.execute('SELECT count(*), min(id), max(id) FROM public.molecules WHERE dataset_id=%s', (dataset,))
    rows, low, high = cur.fetchone()
    return {'datasetId': dataset, 'rows': rows, 'minId': low, 'maxId': high, **(write_counters or counters(cur))}

def resolve_dataset(cur, body):
    cur.execute('SELECT id FROM public.datasets WHERE name=%s',(body['datasetName'],))
    datasets=cur.fetchall()
    if len(datasets)!=1: raise RuntimeError('Configured stock dataset is unavailable or ambiguous')
    dataset=datasets[0][0]
    if body.get('datasetId') is not None and dataset!=body['datasetId']:raise RuntimeError('Configured stock dataset identity differs')
    return dataset

def export_ids(body):
    """Stream every identifier of the configured dataset as JSON lines for the lookup build."""
    # Write counters are not covered by a snapshot, so read them BEFORE it: a
    # write between the two can then only make the stored counters too low,
    # which later reads as stale (safe), never as fresh with missing rows.
    with psycopg.connect(settings.database_url, client_encoding='utf8', autocommit=True) as side:
        with side.cursor() as cur: before=counters(cur)
    with psycopg.connect(settings.database_url, client_encoding='utf8') as conn:
        with conn.cursor() as cur:
            # One snapshot for count/min/max and the exported rows.
            cur.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
            dataset=resolve_dataset(cur, body)
            print(json.dumps({'fingerprint': fingerprint(cur, dataset, before)}))
            exported=0
            with conn.cursor(name='pyxis_stock_ids') as rows:
                rows.itersize=20000
                rows.execute("SELECT m.id, m.metadata->>'ID', m.metadata->>'MAIN_BAS', m.metadata->>'compound_id' FROM public.molecules m WHERE m.dataset_id=%s ORDER BY m.id",(dataset,))
                for row in rows:
                    sys.stdout.write(json.dumps(row, separators=(',',':'))+'\n');exported+=1
    with psycopg.connect(settings.database_url, client_encoding='utf8', autocommit=True) as side:
        with side.cursor() as cur: after=counters(cur)
    # The table changed during the export: refuse rather than ship a lookup
    # that would be stale from its first query.
    print(json.dumps({'complete': after==before, 'rows': exported}))

def search(body):
    mode, query, cap = body['mode'], body['query'], int(body['cap'])
    if mode not in ('id','exact','substructure') or not 1 <= cap <= 1001 or len(query)>2000:
        raise ValueError('Invalid owned-stock query')
    with psycopg.connect(settings.database_url, client_encoding='utf8') as conn:
        with conn.cursor() as cur:
            cur.execute('SET TRANSACTION READ ONLY')
            cur.execute("SET LOCAL statement_timeout = '25s'")
            cur.execute('SET LOCAL rdkit.do_chiral_sss = true')
            dataset=resolve_dataset(cur, body)
            lookup=body.get('lookup')
            if mode=='id' and lookup is not None:
                # Candidates come from the identifier lookup; the predicate below is
                # the same text equality as the full scan, so a hash collision or a
                # stale candidate can never match. A changed dataset falls back.
                ids=lookup.get('ids')
                if not isinstance(ids,list) or len(ids)>10000 or any(not isinstance(i,int) for i in ids):raise ValueError('Invalid identifier lookup')
                if fingerprint(cur, dataset)!=lookup.get('fingerprint'):return {'stale':True}
                cur.execute('SELECT m.id,m.canonical_smiles,m.metadata FROM public.molecules m WHERE m.id = ANY(%s) AND m.dataset_id=%s AND '+ID_CONDITION+' ORDER BY m.id LIMIT %s',[ids,dataset,query,query,query,cap])
                rows=cur.fetchall()
                return {'results':[{'molecule_id':r[0],'canonical_smiles':r[1],'metadata':r[2],'source':'stock'} for r in rows], 'truncated':len(rows)==cap}
            if mode=='id':
                condition=ID_CONDITION
                parameters=[query,query,query]
            elif mode=='exact':
                cur.execute('SELECT mol_to_smiles(mol_from_smiles(%s::cstring))',(query,))
                canonical=cur.fetchone()[0]
                if canonical is None: raise ValueError('Invalid SMILES')
                condition='m.canonical_smiles = %s AND m.mol @= mol_from_smiles(%s::cstring)'
                parameters=[canonical,query]
            else:
                cur.execute('SELECT qmol_from_smarts(%s::cstring) IS NOT NULL',(query,))
                if not cur.fetchone()[0]: raise ValueError('Invalid SMILES/SMARTS pattern')
                condition='m.mol @> qmol_from_smarts(%s::cstring)'
                parameters=[query]
            cur.execute('SELECT m.id,m.canonical_smiles,m.metadata FROM public.molecules m WHERE m.dataset_id=%s AND '+condition+' ORDER BY m.id LIMIT %s',[dataset,*parameters,cap])
            rows=cur.fetchall()
    return {'results':[{'molecule_id':r[0],'canonical_smiles':r[1],'metadata':r[2],'source':'stock'} for r in rows], 'truncated':len(rows)==cap}

if __name__=='__main__':
    try:
        body=json.load(sys.stdin)
        if body.get('mode')=='export_ids':export_ids(body)
        else:print(json.dumps(search(body)))
    except ValueError as error: print(json.dumps({'error':str(error),'status':400}))
    except Exception: print(json.dumps({'error':'Owned stock query is unavailable','status':503}))
