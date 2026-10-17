import assert from 'node:assert/strict';
import http from 'node:http';
import { createOwnedSearch, mergeOwnedSearch, parseOwnedSearch } from '../utils/ownedSearch.js';
let checks=0;
function check(label,fn){fn();checks++;console.log(`PASS ${label}`);}
const query={source:'both',mode:'id',queries:['DUP','UNKNOWN'],offset:0,limit:50};
check('bounded query validation',()=>{
 for(const body of [{...query,source:'legacy'},{...query,mode:'regex'},{...query,queries:[]},{...query,queries:Array(21).fill('x')},{...query,offset:901},{...query,queries:[' ']},{...query,limit:101}])assert.throws(()=>parseOwnedSearch(body));
 assert.equal(parseOwnedSearch({...query,queries:[' RPX 123 ']}).queries[0],'RPX 123');
});
check('methods validate without restoring supplier routes',()=>{
 assert.throws(()=>parseOwnedSearch({...query,mode:'similarity',similarity_metric:'ctanimoto'}));
 assert.throws(()=>parseOwnedSearch({...query,source:'stock',mode:'similarity',similarity_metric:'count_tanimoto'}));
 assert.equal(parseOwnedSearch({...query,mode:'similarity',similarity_metric:'count_dice'}).similarityMetric,'count_dice');
});
check('multi selections are distinct known collections in display order, Morgan Tanimoto only',()=>{
 const multi={...query,source:'multi',mode:'similarity',queries:['CCO']};
 for(const sources of [undefined,[],['stock','stock'],['open'],['both'],['stock','smallvirtual','real','virtual','x']])assert.throws(()=>parseOwnedSearch({...multi,sources}));
 assert.deepEqual(parseOwnedSearch({...multi,sources:['virtual','stock','smallvirtual']}).collections,['stock','smallvirtual','virtual']);
 assert.throws(()=>parseOwnedSearch({...multi,sources:['stock','real'],similarity_metric:'count_tanimoto'}));
 assert.throws(()=>parseOwnedSearch({...multi,sources:['stock','real'],fingerprint_type:'maccs'}));
 assert.throws(()=>parseOwnedSearch({...query,source:'smallvirtual',mode:'similarity',queries:['CCO'],similarity_metric:'nope'}));
});
check('union preserves duplicate codes and source/row identities',()=>{
 const rows=[{source:'real',molecule_id:1},{source:'real',molecule_id:2},{source:'virtual',molecule_id:1}];
 const data=mergeOwnedSearch(query,[{results:rows},{results:[rows[0]]}]);
 assert.equal(data.results.length,3);assert.deepEqual(data.results[0].matchedQueryIndices,[0,1]);assert.equal(data.totalExact,true);
});
check('batch similarity ranks union by maximum score with deterministic identity ties',()=>{
 const data=mergeOwnedSearch({...query,mode:'similarity',limit:2},[
 {results:[{source:'real',molecule_id:1,similarity:0.4},{source:'virtual',molecule_id:4,similarity:0.9}]},
 {results:[{source:'real',molecule_id:1,similarity:0.95},{source:'real',molecule_id:2,similarity:0.9}],truncated:true},
 ]);
 assert.deepEqual(data.results.map(r=>r.molecule_id),[1,2]);assert.equal(data.results[0].similarity,0.95);assert.equal(data.hasMore,true);assert.equal(data.totalExact,false);assert.equal(data.truncated,true);
});
check('invalid and unmatched queries retain separate provenance',()=>{
 const data=mergeOwnedSearch(query,[{results:[],error:'Invalid SMILES'},{results:[]}]);
 assert.deepEqual(data.queries.map(q=>q.status),['error','unmatched']);assert.equal(data.totalExact,false);
});
const secret='owned-search-testing-secret-long-enough';
let upstreamStatus=200;let similarityLimit;let healthSources=['stock','real','virtual'];const similarityCalls=[];
const provider=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');
 if(url.pathname==='/health')return res.end(JSON.stringify({available:true,sources:healthSources}));
 if(url.pathname==='/v1/search/similarity'){
  similarityLimit=Number(url.searchParams.get('limit'));
  const dataset=url.searchParams.get('dataset_ids')||url.searchParams.get('dataset_id');similarityCalls.push(dataset);
  if(dataset==='3')return res.end(JSON.stringify({results:[{source:'smallvirtual',molecule_id:1,canonical_smiles:'c1ccccc1O',similarity:0.9,metadata:{ID:'16749288-857950',MAIN_BAS:'16749288-857950',CURRENT_TOT_NETTO_MG:'5',Lead_TIME:'28 days'}}]}));
  if(dataset==='4')return res.end(JSON.stringify({results:[{molecule_id:7,canonical_smiles:'CCN',similarity:0.85,metadata:{MAIN_BAS:'BAS 00123456',CURRENT_TOT_NETTO_MG:'10'}}]}));
  return res.end(JSON.stringify({results:[{source:'real',molecule_id:1,canonical_smiles:'CCO',similarity:0.8,metadata:{MAIN_BAS:'RPX 202406561',web_mg:'5'}}]}));
 }
 let body='';for await(const chunk of req)body+=chunk;const input=body?JSON.parse(body):{};
 if(url.pathname.startsWith('/molecule/'))return res.end(JSON.stringify({molecules:[
  {molecule_chembl_id:'CHEMBL545',molecule_structures:{canonical_smiles:'CCO'}},
  {molecule_chembl_id:'CHEMBL546',molecule_structures:{canonical_smiles:'CCN'}}]}));
 if(url.pathname.startsWith('/substructure/'))return res.end(JSON.stringify({molecules:[
  {molecule_chembl_id:'CHEMBL1',molecule_structures:{canonical_smiles:'C[C@H](O)F'}},
  {molecule_chembl_id:'CHEMBL2',molecule_structures:{canonical_smiles:'C[C@@H](O)F'}}],page_meta:{total_count:3}}));
 if(url.pathname==='/verify')return res.end(JSON.stringify({matches:[true,false],useChirality:true}));
 if(url.pathname==='/search'){
  res.statusCode=upstreamStatus;
  if(upstreamStatus!==200)return res.end(JSON.stringify({error:'Upstream denied'}));
  if(input.query==='INVALID'){res.statusCode=400;return res.end(JSON.stringify({error:'Invalid SMILES'}));}
  if(input.source==='smallvirtual')return res.end(JSON.stringify({results:[{source:'smallvirtual',molecule_id:2,canonical_smiles:'CCO',metadata:{ID:'1-2',MAIN_BAS:'1-2'}}],truncated:true}));
  if(input.source==='stock')return res.end(JSON.stringify({results:[{molecule_id:7,canonical_smiles:'CCO',metadata:{MAIN_BAS:'BAS 00123456',CURRENT_TOT_NETTO_MG:'10'}}],truncated:false}));
  return res.end(JSON.stringify({results:input.query==='UNKNOWN'?[]:[
   {source:'real',molecule_id:1,canonical_smiles:'CCO',metadata:{ID:'same',MAIN_BAS:'RPX 202406561',web_mg:'5'}},
   {source:'virtual',molecule_id:1,canonical_smiles:'CCO',metadata:{MAIN_BAS:'VPX 900000003'}}],truncated:false}));
 }
 res.statusCode=404;res.end('{}');
});
await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${provider.address().port}`;
const datasets={real:{source:'real',id:1,name:'real',rowCount:6,metrics:['tanimoto','count_dice']},virtual:{source:'virtual',id:2,name:'virtual',rowCount:6,metrics:['tanimoto','count_dice']},smallvirtual:{source:'smallvirtual',id:3,name:'smallvirtual',rowCount:6,metrics:['tanimoto']}};
const owned=createOwnedSearch({graphBase:base,fetchImpl:fetch,stockConfig:{baseUrl:base},stockResolver:{resolve:async()=>({id:4,name:'Stock'})},macroConfig:{baseUrl:base},macroResolver:{resolve:async source=>datasets[source]},openConfig:{enabled:false},secret});
try{
 const status=await owned.status('both');check('status advertises only qualified source capabilities',()=>{assert.equal(status.available,true);assert.deepEqual(status.modes,['id','exact','substructure','similarity']);});
 const data=await owned.run(query);check('real HTTP graph proxy retains offers and query provenance',()=>{
  assert.equal(data.results.length,2);assert.equal(data.queries[1].status,'unmatched');assert.equal(data.source,'both');assert.equal(data.mode,'id');
  assert.ok(data.results[0].shopOffer?.token);
 });
 const invalid=await owned.run({...query,queries:['INVALID','DUP']});check('per-query bad input preserves valid query results',()=>{assert.equal(invalid.queries[0].status,'error');assert.equal(invalid.results.length,2);});
 upstreamStatus=401;await assert.rejects(owned.run(query),error=>error.status===502);checks++;console.log('PASS upstream auth is 502, never a dead browser session');upstreamStatus=200;
 await owned.run({...query,mode:'similarity',queries:['CCO'],offset:150,limit:50});check('batch pagination fetches required per-query candidate prefix',()=>assert.equal(similarityLimit,201));
 let tick=0;const slow=createOwnedSearch({graphBase:base,fetchImpl:fetch,stockConfig:{baseUrl:base},stockResolver:{resolve:async()=>({id:4,name:'Stock'})},macroConfig:{baseUrl:base},macroResolver:{resolve:async source=>datasets[source]},openConfig:{enabled:false},secret,now:()=>(tick++)*100000});
 await assert.rejects(slow.run(query),error=>error.status===503&&/reduce the number of queries/.test(error.message));checks++;console.log('PASS exhausted batch budget keeps its 503 and actionable message');
 const open=createOwnedSearch({graphBase:base,fetchImpl:fetch,openConfig:{enabled:true,baseUrl:base},secret});
 const openExact=await open.run({source:'open',mode:'exact',queries:['OCC'],limit:10});
 check('open exact canonicalizes chemistry and never mints offers',()=>{assert.equal(openExact.results.length,1);assert.equal(openExact.results[0].chemblId,'CHEMBL545');assert.equal(openExact.results[0].shopOffer,undefined);assert.equal(openExact.sendsQueryExternally,true);});
 const openId=await open.run({source:'open',mode:'id',queries:['chembl545','CHEMBL999'],limit:10});
 check('open ID matches only requested ChEMBL identity',()=>{assert.equal(openId.results.length,1);assert.equal(openId.queries[1].status,'unmatched');});
 const openSub=await open.run({source:'open',mode:'substructure',queries:['C[C@H](O)F'],limit:10});
 check('open substructure verifies retrieved graph and exposes retrieval bounds',()=>{assert.equal(openSub.results.length,1);assert.equal(openSub.results[0].chemblId,'CHEMBL1');assert.equal(openSub.truncated,true);assert.equal(openSub.totalExact,false);});
 similarityCalls.length=0;
 const all=await owned.run({source:'multi',sources:['virtual','smallvirtual','stock','real'],mode:'similarity',queries:['CCO'],threshold:0.5,limit:10});
 check('multi similarity ranks every selected collection in one list, RPX+VPX as one scan',()=>{
  assert.deepEqual(similarityCalls.sort(),['1,2','3','4']);assert.equal(all.source,'multi');assert.deepEqual(all.sources,['stock','smallvirtual','real','virtual']);
  assert.deepEqual(all.results.map(r=>[r.source,r.similarity]),[['smallvirtual',0.9],['stock',0.85],['real',0.8]]);
 });
 check('small-molecule virtual rows get signed made-to-order VPX-tier offers',()=>{
  const offer=all.results[0].shopOffer;assert.ok(offer?.token);assert.equal(offer.source,'smallvirtual');assert.equal(offer.code,'16749288-857950');
  assert.deepEqual(offer.packs.map(p=>[p.mg,p.eur]),[[1,400],[2,460],[5,529]]);assert.equal(offer.availableMg,null);
 });
 await assert.rejects(owned.run({source:'multi',sources:['smallvirtual','real'],mode:'similarity',queries:['CCO'],similarity_metric:'count_dice'}),error=>error.status===400);checks++;console.log('PASS multi refuses count metrics before any scan');
 const multiId=await owned.run({source:'multi',sources:['stock','smallvirtual'],mode:'id',queries:['DUP']});
 check('multi graph search unions per-collection results and keeps truncation',()=>{assert.deepEqual(multiId.results.map(r=>r.source),['stock','smallvirtual']);assert.equal(multiId.truncated,true);assert.equal(multiId.totalExact,false);});
 const noGraph=await owned.status('multi','stock,smallvirtual');
 check('multi status offers graph modes only when every selected collection has a graph screen',()=>{assert.equal(noGraph.available,true);assert.deepEqual(noGraph.modes,['similarity']);});
 healthSources=['stock','real','virtual','smallvirtual'];
 const withGraph=await owned.status('multi','stock,smallvirtual');check('multi status advertises graph modes once qualified',()=>{assert.deepEqual(withGraph.modes,['id','exact','substructure','similarity']);assert.deepEqual(withGraph.sources,['stock','smallvirtual']);});
 const badStatus=await owned.status('multi','stock,nope');check('multi status with an unknown collection is unavailable, not an error',()=>assert.equal(badStatus.available,false));
 const openStatus=await owned.status('open');check('disabled open source never substitutes owned rows',()=>assert.equal(openStatus.available,false));
}finally{await new Promise(resolve=>provider.close(resolve));}
console.log(`owned search: ${checks} checks passed`);
