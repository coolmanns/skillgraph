import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEvaluationCase} from '../src/evaluation-contract.js';
const manifest={source_instance_id:'synthetic',source_locator_hmac:'bound',selection:{sessionIds:['s'],since:'2026-01-01T00:00:00Z',until:'2027-01-01T00:00:00Z'}};
function fixture(){return {c:{contract:'hermes-task-case.v1',case_id:'probe',source_instance_id:'synthetic',source_locator_hmac:'bound',session_id:'s',family:'synthetic',lineage_group:'synthetic',decision_row_id:1,decision_at:1770000000,inputs:{context:[{row_id:1,origin:'human_request',summary:'Synthetic request'}],eligible_catalog:null},review:{label_source:'reviewer',review_version:'test',outcome:'partial',evidence:[{row_id:2,kind:'tool_result',scope:'Synthetic result'}],skills:[],corrections:[],skill_edits:[],acceptance:[{predicate:'Synthetic condition',state:'supported',evidence_rows:[2]}],limitations:['Synthetic fixture only'],unchosen_outcomes:'unknown'}},rows:new Map([[1,{id:1,session_id:'s',profile_name:'default',role:'user',timestamp:1770000000}],[2,{id:2,session_id:'s',profile_name:'default',role:'tool',timestamp:1770000001}]])};}
test('control: bounded partial case accepted',()=>{const {c,rows}=fixture();assert.equal(validateEvaluationCase(c,manifest,rows),c);});
test('verified success requires acceptance predicates',()=>{
 const {c,rows}=fixture();c.review.outcome='verified_success';
 assert.equal(validateEvaluationCase(c,manifest,rows),c,'positive control');
 c.review.acceptance=[];
 assert.throws(()=>validateEvaluationCase(c,manifest,rows),/verified success requires acceptance predicates/);
 c.review.outcome='partial';assert.equal(validateEvaluationCase(c,manifest,rows),c);
});
test('assistant claim cannot be sole support for verified success',()=>{
 const {c,rows}=fixture();c.review.outcome='verified_success';
 assert.equal(validateEvaluationCase(c,manifest,rows),c);
 c.review.evidence[0].kind='assistant_claim';rows.get(2).role='assistant';
 assert.throws(()=>validateEvaluationCase(c,manifest,rows),/verified success requires supported non-claim evidence per predicate/);
 c.review.outcome='partial';assert.equal(validateEvaluationCase(c,manifest,rows),c);
});
test('assistant row cannot be relabeled as tool result',()=>{const {c,rows}=fixture();rows.get(2).role='assistant';assert.throws(()=>validateEvaluationCase(c,manifest,rows),/evidence role\/origin mismatch/);});
test('success support must be referenced by every supported predicate',()=>{
 const {c,rows}=fixture();c.review.outcome='verified_success';
 rows.set(3,{...rows.get(2),id:3,role:'assistant'});
 c.review.evidence.push({row_id:3,kind:'assistant_claim',scope:'Claim'});
 c.review.acceptance.push({predicate:'Second condition',state:'supported',evidence_rows:[3]});
 assert.throws(()=>validateEvaluationCase(c,manifest,rows),/supported non-claim evidence per predicate/);
 c.review.acceptance[1].evidence_rows=[2,3];assert.equal(validateEvaluationCase(c,manifest,rows),c);
 for(const state of ['unknown','contradicted']){
  c.review.acceptance[1].state=state;
  assert.throws(()=>validateEvaluationCase(c,manifest,rows),/supported non-claim evidence per predicate/);
  c.review.outcome='partial';assert.equal(validateEvaluationCase(c,manifest,rows),c);c.review.outcome='verified_success';
 }
});
for(const [kind,role] of [['system_notification','user'],['compaction','user'],['test_red','tool']])test(`${kind} alone is not success support`,()=>{
 const {c,rows}=fixture();c.review.outcome='verified_success';c.review.evidence[0].kind=kind;rows.get(2).role=role;
 assert.throws(()=>validateEvaluationCase(c,manifest,rows),/supported non-claim evidence per predicate/);
 c.review.outcome='partial';assert.equal(validateEvaluationCase(c,manifest,rows),c);
});
for(const kind of ['tool_result','test_green','readback','skill_load','skill_edit','human_feedback'])test(`${kind} can structurally support a success predicate`,()=>{
 const {c,rows}=fixture();c.review.outcome='verified_success';c.review.evidence[0].kind=kind;rows.get(2).role=kind==='human_feedback'?'user':'tool';
 assert.equal(validateEvaluationCase(c,manifest,rows),c);
 for(const change of [{session_id:'other'},{profile_name:'other'},{timestamp:1999999999}]){
  const other=new Map(rows);other.set(2,{...rows.get(2),...change});
  assert.throws(()=>validateEvaluationCase(c,manifest,other),/evidence outside source selection/);
 }
});
