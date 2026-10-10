#!/usr/bin/env python3
"""Read-only stock graph/identifier query inside the existing scientific API runtime.
Invoked with fixed argv and JSON stdin, never credentials or SQL from the caller.
"""
import json, sys
import psycopg
from app.config import settings

def search(body):
    mode, query, cap = body['mode'], body['query'], int(body['cap'])
    if mode not in ('id','exact','substructure') or not 1 <= cap <= 1001 or len(query)>2000:
        raise ValueError('Invalid owned-stock query')
    with psycopg.connect(settings.database_url, client_encoding='utf8') as conn:
        with conn.cursor() as cur:
            cur.execute('SET TRANSACTION READ ONLY')
            cur.execute("SET LOCAL statement_timeout = '25s'")
            cur.execute('SET LOCAL rdkit.do_chiral_sss = true')
            cur.execute('SELECT id FROM public.datasets WHERE name=%s',(body['datasetName'],))
            datasets=cur.fetchall()
            if len(datasets)!=1: raise RuntimeError('Configured stock dataset is unavailable or ambiguous')
            dataset=datasets[0][0]
            if body.get('datasetId') is not None and dataset!=body['datasetId']:raise RuntimeError('Configured stock dataset identity differs')
            if mode=='id':
                condition="(m.metadata->>'ID' = %s OR m.metadata->>'MAIN_BAS' = %s OR m.metadata->>'compound_id' = %s)"
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
    try: print(json.dumps(search(json.load(sys.stdin))))
    except ValueError as error: print(json.dumps({'error':str(error),'status':400}))
    except Exception: print(json.dumps({'error':'Owned stock query is unavailable','status':503}))
