import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../src/evaluation-contract.js').catch(()=>({}));
const manifest={source_instance_id:'source',source_locator_hmac:'bound',selection:{sessionIds:['s'],since:'2026-01-01T00:00:00Z',until:'2027-01-01T00:00:00Z'}};
const rows=new Map([[1,{id:1,session_id:'s',profile_name:'default',role:'user',timestamp:1770000000}],[2,{id:2,session_id:'s',profile_name:'default',role:'tool',timestamp:1770000001}]]);
const fixture=()=>({contract:'hermes-task-case.v1',case_id:'case',source_instance_id:'source',source_locator_hmac:'bound',session_id:'s',family:'artifact',lineage_group:'lineage',decision_row_id:1,decision_at:1770000000,inputs:{context:[{row_id:1,origin:'human_request',summary:'Update the document'}],eligible_catalog:null},review:{label_source:'reviewer',review_version:'v1',outcome:'partial',evidence:[{row_id:2,kind:'tool_result',scope:'file written'}],skills:[],corrections:[],skill_edits:[],acceptance:[{predicate:'file written',state:'supported',evidence_rows:[2]}],limitations:['Visual quality unknown'],unchosen_outcomes:'unknown'}});
test('versioned case accepts source-bound separate input and scoped review',()=>{
 assert.equal(typeof mod.validateEvaluationCase,'function');assert.equal(mod.validateEvaluationCase(fixture(),manifest,rows).case_id,'case');
 assert.deepEqual(mod.selectorInput(fixture(),manifest,rows),{context:[{row_id:1,origin:'human_request',summary:'Update the document'}],eligible_catalog:null});
});
test('evidence kind cannot relabel a human claim as a tool receipt',()=>{
 const c=fixture();c.review.evidence[0].row_id=1;c.review.acceptance[0].evidence_rows=[1];
 assert.throws(()=>mod.validateEvaluationCase(c,manifest,rows),/role/);
});
test('same timestamp later result cannot enter selector input',()=>{
 const c=fixture();delete c.decision_row_id;
 const r=new Map(rows);r.set(2,{...r.get(2),timestamp:c.decision_at});
 c.inputs.context.push({row_id:2,origin:'prior_context',summary:'Outcome that must not leak'});
 assert.throws(()=>mod.selectorInput(c,manifest,r),/decision/);
 c.decision_row_id=1;assert.throws(()=>mod.selectorInput(c,manifest,r),/post-decision/);
});
test('reference reads are not primary loads',()=>{
 const c=fixture();c.review.skills=[{name:'skill',stage:'reference_read',row_id:2,artifact_hash:null}];
 assert.equal(mod.validateEvaluationCase(c,manifest,rows),c);
});
test('rejects summary/internal rows as human and out-of-window decisions',()=>{
 const r=new Map(rows);r.set(1,{...r.get(1),is_summary:1});assert.throws(()=>mod.validateEvaluationCase(fixture(),manifest,r),/human/);
 r.set(1,{...rows.get(1),origin:'system_notification'});assert.throws(()=>mod.validateEvaluationCase(fixture(),manifest,r),/human/);
 const c=fixture();c.decision_at=1999999999;assert.throws(()=>mod.validateEvaluationCase(c,manifest,rows),/decision/);
});
test('pre-decision projection rejects leakage and incorrect source binding',()=>{
 for(const mutate of [c=>c.inputs.outcome='success',c=>c.inputs.context[0].row_id=2,c=>c.source_locator_hmac='wrong',c=>c.review.unchosen_outcomes='failure',c=>c.inputs.eligible_catalog=['today'],c=>c.review.acceptance[0].evidence_rows=[99]]){
  const c=fixture();mutate(c);assert.throws(()=>mod.selectorInput(c,manifest,rows));
 }
 const r=new Map(rows);r.set(2,{...r.get(2),session_id:'other'});assert.throws(()=>mod.validateEvaluationCase(fixture(),manifest,r));
});
