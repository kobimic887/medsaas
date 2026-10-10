#!/usr/bin/env python3
"""Loopback-only additive graph/ID service. No source table or index is changed."""
import csv, hashlib, json, mmap, os, pathlib, struct, subprocess, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import numpy as np
from rdkit import Chem, DataStructs, rdBase
from build import STRIDE,digest
rdBase.DisableLog("rdApp.*")
FIELDS=['smiles','ID','MAIN_BAS','compound_id','source','source_file','web_mg','web_uM','CURRENT_TOT_NETTO_MG','CURRENT_TOT_AMOUNT_UM','Lead_TIME']

class GraphStore:
    def __init__(self,index_dir,graph_dir,sources=('real','virtual'),skip_missing=False):
        self.datasets={}
        for source in sources:
            index_dir,graph_dir=pathlib.Path(index_dir),pathlib.Path(graph_dir)
            if skip_missing and not (graph_dir/f'{source}.graph.json').exists():continue
            manifest_path=index_dir/f'{source}.manifest.json'
            original=json.loads(manifest_path.read_text())
            meta=json.loads((graph_dir/f'{source}.graph.json').read_text())
            if not (meta['complete'] and meta['rows']==original['indexedRows'] and meta['recordBytes']==STRIDE):raise ValueError('Graph artifact is incomplete or incompatible')
            if meta['rdkitVersion']!=rdBase.rdkitVersion:raise ValueError('Graph screen/query RDKit versions differ')
            if meta['indexManifestSha256']!=hashlib.sha256(manifest_path.read_bytes()).hexdigest():raise ValueError('Graph artifact belongs to a different source index')
            if (graph_dir/f'{source}.graph').stat().st_size!=STRIDE*meta['rows']:raise ValueError('Graph artifact size differs')
            if (index_dir/f'{source}.fpb').stat().st_size!=266*meta['rows']:raise ValueError('Source offset index is incomplete')
            self.datasets[source]={'rows':meta['rows'],'graph':np.memmap(graph_dir/f'{source}.graph',dtype=np.uint8,mode='r',shape=(meta['rows'],STRIDE)),
              'offsets':np.memmap(index_dir/f'{source}.fpb',dtype=np.dtype([('offset','<u8'),('rest','u1',(258,))]),mode='r'),
              'file':open(index_dir/f'{source}.rows.csv','rb')}
    def row(self,source,index):
        data=self.datasets[source];handle=data['file'];handle.seek(int(data['offsets'][index]['offset']))
        raw=dict(zip(FIELDS,next(csv.reader([handle.readline().decode('utf8').rstrip('\n')]))))
        return {'source':source,'molecule_id':index+1,'canonical_smiles':raw.pop('smiles'),'metadata':raw}
    def search(self,source,mode,query,cap,deadline=None):
        sources=['real','virtual'] if source=='both' else [source]
        if any(s not in self.datasets for s in sources): raise RuntimeError('Requested macrocycle graph dataset is unavailable')
        molecule=None;pattern=None
        if mode=='exact':
            molecule=Chem.MolFromSmiles(query)
            if molecule is None: raise ValueError('Invalid SMILES')
            canonical=Chem.MolToSmiles(molecule,isomericSmiles=True);key=np.frombuffer(digest(canonical),dtype=np.uint8)
        elif mode=='id':key=np.frombuffer(digest(query),dtype=np.uint8)
        elif mode=='substructure':
            molecule=Chem.MolFromSmarts(query)
            if molecule is None: raise ValueError('Invalid SMILES/SMARTS pattern')
            pattern=np.frombuffer(DataStructs.BitVectToBinaryText(Chem.PatternFingerprint(molecule,fpSize=2048)),dtype=np.uint8)
            bits=np.flatnonzero(pattern)
        else:raise ValueError('Invalid graph search mode')
        results=[]
        for selected in sources:
            data=self.datasets[selected]
            for start in range(0,data['rows'],8192):
                if deadline and time.monotonic()>deadline:raise TimeoutError('Graph search exceeded its time budget; narrow the pattern or batch')
                rows=data['graph'][start:start+8192]
                if mode=='exact':mask=np.all(rows[:,:16]==key,axis=1)
                elif mode=='id':mask=np.all(rows[:,16:32]==key,axis=1)|np.all(rows[:,32:48]==key,axis=1)
                else:
                    mask=np.ones(len(rows),dtype=bool)
                    # Pattern bits are a necessary screen only. The final graph
                    # match below enforces bonds, aromaticity and query chirality.
                    for byte in bits:
                        mask &= (rows[:,48+byte]&pattern[byte])==pattern[byte]
                        if not mask.any():break
                for local in np.flatnonzero(mask):
                    row=self.row(selected,start+int(local))
                    if mode=='id':matched=query in [row['metadata'].get(k) for k in ('ID','MAIN_BAS','compound_id')]
                    else:
                        target=Chem.MolFromSmiles(row['canonical_smiles'])
                        if target is None:raise RuntimeError('Indexed graph cannot be parsed')
                        matched=(Chem.MolToSmiles(target,isomericSmiles=True)==canonical) if mode=='exact' else target.HasSubstructMatch(molecule,useChirality=True)
                    if matched:
                        results.append(row)
                        if len(results)>=cap:return {'results':results,'truncated':True}
        return {'results':results,'truncated':False}

# Bounded wait so a concurrent slow query delays, not fails, other users.
GATE_WAIT_SECONDS=15

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass # Private query text must not enter access logs.
    def reply(self,status,payload):
        data=json.dumps(payload).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def do_GET(self):
        if self.path=='/health':return self.reply(200,{'available':True,'sources':['stock',*self.server.store.datasets],'rdkitVersion':rdBase.rdkitVersion})
        self.reply(404,{'error':'Not found'})
    def do_POST(self):
        if self.path not in ('/search','/verify'):return self.reply(404,{'error':'Not found'})
        length=int(self.headers.get('Content-Length','0'))
        if not 1<=length<=2000000:return self.reply(400,{'error':'Invalid request size'})
        try:
            body=json.loads(self.rfile.read(length))
            if self.path=='/verify':
                query=body.get('query');smiles=body.get('smiles')
                if not isinstance(query,str) or len(query)>2000 or not isinstance(smiles,list) or len(smiles)>1001 or any(not isinstance(s,str) or len(s)>10000 for s in smiles):raise ValueError('Invalid verification request')
                if not self.server.gate.acquire(timeout=GATE_WAIT_SECONDS):return self.reply(503,{'error':'Owned graph search is busy; retry shortly'})
                try:
                    molecule=Chem.MolFromSmiles(query)
                    if molecule is None:raise ValueError('Open substructure requires valid SMILES')
                    matches=[]
                    for value in smiles:
                        target=Chem.MolFromSmiles(value)
                        matches.append(bool(target and target.HasSubstructMatch(molecule,useChirality=True)))
                    return self.reply(200,{'matches':matches,'useChirality':True})
                finally:self.server.gate.release()
            source=body['source'];mode=body['mode'];query=body['query'];cap=body['cap']
            if source not in ('stock','both','real','virtual') or mode not in ('id','exact','substructure') or not isinstance(query,str) or not query or len(query)>2000 or not isinstance(cap,int) or not 1<=cap<=1001:raise ValueError('Invalid owned search query')
            if not self.server.gate.acquire(timeout=GATE_WAIT_SECONDS):return self.reply(503,{'error':'Owned graph search is busy; retry shortly'})
            try:
                if source=='stock':
                    # Fixed helper argv and JSON stdin. Existing container owns
                    # DB settings; they never leave that scientific runtime.
                    result=subprocess.run(['docker','exec','-i','-e','PYTHONPATH=/app','tonomitosql-api-1','python','/tmp/pyxis-owned-stock.py'],input=json.dumps(body),capture_output=True,text=True,timeout=30)
                    payload=json.loads(result.stdout)
                    self.reply(payload.get('status',200),payload)
                else:self.reply(200,self.server.store.search(source,mode,query,cap,time.monotonic()+35))
            finally:self.server.gate.release()
        except ValueError as error:self.reply(400,{'error':str(error)})
        except (TimeoutError,subprocess.TimeoutExpired):self.reply(503,{'error':'Search time budget exceeded; narrow the pattern or reduce the batch'})
        except Exception:self.reply(503,{'error':'Owned graph search is unavailable'})

if __name__=='__main__':
    host=os.environ.get('BIND_HOST','127.0.0.1');port=int(os.environ.get('PORT','8276'))
    if host not in ('127.0.0.1','::1'):raise ValueError('Owned search must bind loopback')
    server=ThreadingHTTPServer((host,port),Handler);server.gate=threading.Lock()
    server.store=GraphStore(os.environ['MACROCYCLE_INDEX_DIR'],os.environ['OWNED_GRAPH_DIR'],skip_missing=True)
    server.serve_forever()
