import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('../src/wrapper-attribution.js').catch(()=>({}));
const call={id:1,session_id:'s',tool_calls:JSON.stringify([{id:'c',function:{name:'tool_call',arguments:JSON.stringify({calls:[{name:'lookup',arguments:{id:3}}]})}}])};
const result={id:2,session_id:'s',tool_call_id:'c',tool_name:'lookup',content:'{"ok":true}'};
test('single deferred dispatch is proven by scoped native ID and one matching nested call',()=>{
 assert.equal(typeof module.deriveWrapperAttribution,'function');
 const records=module.deriveWrapperAttribution({callRows:[call],resultRows:[result],sourceInstanceId:'source',hmacKey:Buffer.alloc(32,7)});
 assert.equal(records.length,1); assert.equal(records[0].status,'resolved');
 assert.equal(records[0].rule,'single-deferred-native-id.v1');
 assert.deepEqual(records[0].row_ids,[1,2]);
 assert.ok(!JSON.stringify(records).includes('arguments'));assert.ok(!JSON.stringify(records).includes('"c"'));
});
const derive=(calls,results=[result])=>module.deriveWrapperAttribution({callRows:calls,resultRows:results,sourceInstanceId:'source',hmacKey:Buffer.alloc(32,7)});
test('malformed native items do not crash or establish attribution',()=>{
 assert.deepEqual(derive([{...call,tool_calls:'[null,3,"bad"]'}]),[]);
});
test('different session/native IDs never join on a name',()=>{
 assert.deepEqual(derive([call],[{...result,session_id:'other'}]),[]);
 assert.deepEqual(derive([call],[{...result,tool_call_id:'other'}]),[]);
});
test('multi-call, differing arguments, identity conflicts and mismatched concrete names remain unresolved',()=>{
 const c=JSON.parse(call.tool_calls)[0];
 const modified=a=>({...call,tool_calls:JSON.stringify([{...c,function:{name:'tool_call',arguments:JSON.stringify(a)}}])});
 for(const a of [{calls:[]},{calls:[{name:'lookup',arguments:{}},{name:'lookup',arguments:{}}]},{calls:[{name:'other',arguments:{}}]},{calls:[{name:'lookup',arguments:'bad'}]}])assert.equal(derive([modified(a)])[0].status,'unresolved');
 assert.equal(derive([call,{...modified({calls:[{name:'lookup',arguments:{id:4}}]}),id:3}])[0].status,'unresolved');
 assert.equal(derive([{...call,tool_calls:JSON.stringify([{...c,call_id:'different'}])}])[0].status,'unresolved');
 assert.equal(derive([{...call,tool_calls:JSON.stringify([{...c,response_item_id:'different'}])}])[0].status,'unresolved');
 assert.equal(derive([call],[result,{...result,id:3,tool_name:'other'}])[0].status,'unresolved');
});
test('documented Responses item ID is distinct from matching id/call_id',()=>{
 const c=JSON.parse(call.tool_calls)[0];
 const row={...call,tool_calls:JSON.stringify([{...c,call_id:c.id,response_item_id:'fc_distinct_item'}])};
 assert.equal(derive([row])[0].status,'resolved');
 const other={...row,id:3,tool_calls:JSON.stringify([{...c,call_id:c.id,response_item_id:'fc_other_item'}])};
 assert.equal(derive([row,other])[0].status,'unresolved');
});
test('input observations and result disagreement are preserved, deterministic replay',()=>{
 const calls=[call],results=[result,{...result,id:3,content:'{"ok":false}'}];const before=JSON.stringify({calls,results});
 const a=derive(calls,results);assert.deepEqual(a,derive(calls,results));
 assert.equal(JSON.stringify({calls,results}),before);assert.match(a[0].scope,/not-result-equivalence/);
});
