#!/usr/bin/env python3
import csv, json, pathlib, tempfile, struct, hashlib, time
from rdkit import Chem
from build import build, STRIDE
from serve import GraphStore, FIELDS, substructure_query

def fixture(directory):
    structures=[('CCO','DUP'),('OCC','DUP'),('C[C@H](O)F','LEFT'),('C[C@@H](O)F','RIGHT'),('Oc1ccccc1','AROM'),('C1CCCCC1','ALIPH')]
    for source in ('real','virtual'):
        offsets=[]
        with (directory/f'{source}.rows.csv').open('w',newline='') as file:
            writer=csv.writer(file)
            for smiles,code in structures:
                offsets.append(file.tell()); writer.writerow([smiles,code,code,code,'macrocycle_'+source,'fixture.csv','5','','','','28 days'])
        with (directory/f'{source}.fpb').open('wb') as file:
            for offset in offsets:file.write(struct.pack('<Q',offset)+bytes(258))
        (directory/f'{source}.manifest.json').write_text(json.dumps({'source':source,'indexedRows':len(structures)}))

with tempfile.TemporaryDirectory() as temporary:
    base=pathlib.Path(temporary);index=base/'index';graph=base/'graph';index.mkdir();fixture(index)
    build(index,graph,'real');build(index,graph,'virtual')
    store=GraphStore(index,graph)
    result=store.search('both','id','DUP',100)
    assert [(r['source'],r['molecule_id']) for r in result['results']]==[('real',1),('real',2),('virtual',1),('virtual',2)]
    assert len(store.search('real','exact','OCC',100)['results'])==2
    assert [r['molecule_id'] for r in store.search('real','exact','C[C@H](O)F',100)['results']]==[3]
    assert [r['molecule_id'] for r in store.search('real','substructure','c1ccccc1',100)['results']]==[5]
    assert [r['molecule_id'] for r in store.search('real','substructure','C[C@H](O)F',100)['results']]==[3]
    # Kekule SMILES (Ketcher drawings) must find aromatic rows; as SMARTS they matched nothing.
    assert [r['molecule_id'] for r in store.search('real','substructure','C1=CC=CC=C1',100)['results']]==[5]
    assert [r['molecule_id'] for r in store.search('real','substructure','C1C=CC=CC=1O',100)['results']]==[5]
    assert store.search('real','substructure','C=C',100)['results']==[] # a double bond is not aromatic
    # SMARTS-only meaning survives: bracket H counts, dummies and query bonds.
    assert [r['molecule_id'] for r in store.search('real','substructure','[CH2]',100)['results']]==[1,2,6]
    assert [r['molecule_id'] for r in store.search('real','substructure','c~O',100)['results']]==[5]
    assert [substructure_query(q)[1] for q in ('c1ccccc1','C1=CC=CC=C1','[nH]1cccc1','[#6]','[CH3]','*c1ccccc1','C~C','[C,N]')]==['smiles','smiles','smiles','smarts','smarts','smarts','smarts','smarts']
    assert store.search('real','id','UNKNOWN',100)['results']==[]
    assert store.search('both','substructure','[#6]',2)['truncated']
    assert len(store.search('both','substructure','[#6]',2)['results'])==2
    try:store.search('real','exact','not-smiles',100);assert False
    except ValueError:pass
    try:store.search('real','substructure','[',100);assert False
    except ValueError:pass
    try:store.search('real','substructure','C',100,deadline=time.monotonic()-1);assert False
    except TimeoutError:pass
    assert store.row('virtual',4)['metadata']['MAIN_BAS']=='AROM'
    metadata=graph/'real.graph.json';content=json.loads(metadata.read_text());content['complete']=False;metadata.write_text(json.dumps(content))
    try:GraphStore(index,graph);assert False
    except ValueError:pass
# Stock identifier lookup: candidate screen only, exact hash buckets, sha-checked.
import numpy as np
from stock_ids import StockIdLookup, ENTRY, FORMAT_VERSION, key
with tempfile.TemporaryDirectory() as temporary:
    base=pathlib.Path(temporary)
    pairs=sorted({(key(v),i) for i,values in ((11,['04188606','BAS 04188606']),(12,['DUP']),(13,['DUP'])) for v in values})
    entries=np.array(pairs,dtype=ENTRY);np.save(base/'stock.ids.npy',entries)
    manifest={'formatVersion':FORMAT_VERSION,'complete':True,'datasetName':'Stock','fingerprint':{'datasetId':4},'entries':len(entries),'sha256':hashlib.sha256((base/'stock.ids.npy').read_bytes()).hexdigest()}
    (base/'stock.ids.json').write_text(json.dumps(manifest))
    lookup=StockIdLookup(base)
    assert lookup.candidates('04188606')==[11] and lookup.candidates('BAS 04188606')==[11]
    assert lookup.candidates('DUP')==[12,13] and lookup.candidates('dup')==[] and lookup.candidates('04188606 ')==[]
    assert lookup.matches({'datasetName':'Stock'}) and lookup.matches({'datasetName':'Stock','datasetId':4})
    assert not lookup.matches({'datasetName':'Stock','datasetId':5}) and not lookup.matches({'datasetName':'Other'})
    manifest['sha256']='0'*64;(base/'stock.ids.json').write_text(json.dumps(manifest))
    try:StockIdLookup(base);assert False
    except ValueError:pass
print('owned graph search: 19 meaningful checks passed (canonical, stereo, true graph, Kekule SMILES, SMARTS, duplicate identities, bounds, incomplete refusal) + stock identifier lookup')
