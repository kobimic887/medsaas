#!/usr/bin/env python3
"""Additive immutable graph-search screen over existing macrocycle index rows.
No Morgan fingerprint is used for graph matching. Pattern bits only screen;
all survivors are verified against their molecule with RDKit.
"""
import argparse, csv, hashlib, json, os, pathlib, time
from rdkit import Chem, DataStructs, rdBase
STRIDE = 304

def digest(value):
    return hashlib.sha256(value.encode('utf8')).digest()[:16]

def build(index_dir, out_dir, source, sample=None):
    index_dir, out_dir = pathlib.Path(index_dir), pathlib.Path(out_dir)
    manifest = json.loads((index_dir / f'{source}.manifest.json').read_text())
    out_dir.mkdir(parents=True, exist_ok=True)
    final = out_dir / f'{source}.graph'
    if final.exists():
        raise ValueError('Refusing to overwrite a published graph artifact')
    temporary = out_dir / f'{source}.graph.partial'
    started = time.monotonic()
    count = 0
    with (index_dir / f'{source}.rows.csv').open(newline='') as rows, temporary.open('wb') as output:
        for row in csv.DictReader(rows, fieldnames=['smiles','ID','MAIN_BAS','compound_id','source','source_file','web_mg','web_uM','CURRENT_TOT_NETTO_MG','CURRENT_TOT_AMOUNT_UM','Lead_TIME']):
            mol = Chem.MolFromSmiles(row['smiles'])
            if mol is None:
                raise ValueError(f'Existing indexed row {count+1} cannot be parsed by graph RDKit')
            canonical = Chem.MolToSmiles(mol, isomericSmiles=True)
            pattern = DataStructs.BitVectToBinaryText(Chem.PatternFingerprint(mol, fpSize=2048))
            output.write(digest(canonical) + digest(row.get('MAIN_BAS','')) + digest(row.get('ID','')) + pattern)
            count += 1
            if count % 10000 == 0:
                print(json.dumps({'source':source,'rows':count,'seconds':round(time.monotonic()-started,1)}), flush=True)
            if sample and count >= sample: break
        output.flush(); os.fsync(output.fileno())
    if not sample and count != manifest['indexedRows']:
        raise ValueError('Graph artifact row count differs from existing index')
    if temporary.stat().st_size != count * STRIDE:
        raise ValueError('Graph artifact byte length differs')
    metadata = {'formatVersion':1,'recordBytes':STRIDE,'rows':count,'source':source,
                'rdkitVersion':rdBase.rdkitVersion,'indexManifestSha256':hashlib.sha256((index_dir/f'{source}.manifest.json').read_bytes()).hexdigest(),
                'complete':not bool(sample),'seconds':round(time.monotonic()-started,3)}
    if not sample:
        os.replace(temporary,final)
        (out_dir/f'{source}.graph.json').write_text(json.dumps(metadata,indent=2)+'\n')
    else: temporary.unlink()
    print(json.dumps(metadata),flush=True)
    return metadata

if __name__ == '__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--index-dir',required=True);parser.add_argument('--out-dir',required=True)
    parser.add_argument('--source',choices=['real','virtual','smallvirtual'],required=True);parser.add_argument('--sample',type=int)
    args=parser.parse_args();build(args.index_dir,args.out_dir,args.source,args.sample)
