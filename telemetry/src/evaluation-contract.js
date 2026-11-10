// Structural/provenance validation, not a semantic truth oracle. Summaries need review.
const fail=message=>{throw new Error(message);};
const text=x=>typeof x==='string'&&x.length>0&&x.length<=4000;
function keys(value, allowed) {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('unexpected fields');
}
export function validateEvaluationCase(c,manifest,rows) {
 keys(c,['contract','case_id','source_instance_id','source_locator_hmac','session_id','family','lineage_group','decision_row_id','decision_at','inputs','review']);
 if(c.contract!=='hermes-task-case.v1'||![c.case_id,c.family,c.lineage_group].every(text))fail('case version/group required');
 if(c.source_instance_id!==manifest.source_instance_id||c.source_locator_hmac!==manifest.source_locator_hmac||!manifest.selection.sessionIds.includes(c.session_id))fail('source binding');
 if(!Number.isFinite(c.decision_at))fail('decision timestamp');
 const since=Date.parse(manifest.selection.since)/1000,until=Date.parse(manifest.selection.until)/1000;
 if(!Number.isFinite(since)||!Number.isFinite(until)||c.decision_at<since||c.decision_at>=until)fail('decision outside window');
 const locate=id=>{
  const r=rows.get(id);
  if(!Number.isSafeInteger(id)||!r||r.session_id!==c.session_id||r.profile_name!=='default'||!Number.isFinite(r.timestamp)||r.timestamp<since||r.timestamp>=until)fail('evidence outside source selection');
  return r;
 };
 if(!Number.isSafeInteger(c.decision_row_id)||locate(c.decision_row_id).timestamp!==c.decision_at)fail('decision row/timestamp mismatch');
 keys(c.inputs,['context','eligible_catalog']);
 if(!Array.isArray(c.inputs.context)||!c.inputs.context.length||c.inputs.eligible_catalog!==null)fail('historical catalog must remain unknown');
 for(const x of c.inputs.context){
  keys(x,['row_id','origin','summary']); const r=locate(x.row_id);
  if(x.row_id>c.decision_row_id||r.timestamp>c.decision_at||!text(x.summary)||!['human_request','prior_context'].includes(x.origin))fail('post-decision or invalid context');
  if(x.origin==='human_request'&&(r.role!=='user'||r.is_summary===1||(r.origin&&r.origin!=='human_request')))fail('human request role/origin');
 }
 const v=c.review;
 keys(v,['label_source','review_version','outcome','evidence','skills','corrections','skill_edits','acceptance','limitations','unchosen_outcomes']);
 if(v.label_source!=='reviewer'||!text(v.review_version)||!['partial','unknown','blocked','cancelled','verified_success','verified_failure'].includes(v.outcome)||v.unchosen_outcomes!=='unknown')fail('review provenance/outcome');
 if(!Array.isArray(v.limitations)||!v.limitations.length||!v.limitations.every(text))fail('limitations required');
 if(!Array.isArray(v.evidence)||!v.evidence.length)fail('evidence required');
 for(const e of v.evidence){
  keys(e,['row_id','kind','scope']);const r=locate(e.row_id);
  const role={tool_result:'tool',assistant_claim:'assistant',human_feedback:'user',system_notification:'user',compaction:'user',skill_load:'tool',skill_edit:'tool',test_red:'tool',test_green:'tool',readback:'tool'}[e.kind];
  if(!role||!text(e.scope))fail('evidence kind/scope');
  if(r.role!==role||(e.kind==='human_feedback'&&(r.is_summary===1||(r.origin&&r.origin!=='human_request'))))fail('evidence role/origin mismatch');
 }
 const evidenceIds=new Set(v.evidence.map(e=>e.row_id));
 for(const field of ['skills','corrections','skill_edits','acceptance'])if(!Array.isArray(v[field]))fail('review arrays');
 for(const s of v.skills){keys(s,['name','stage','row_id','artifact_hash']);locate(s.row_id);if(!text(s.name)||!['selected','loaded','reference_read','changed'].includes(s.stage)||s.artifact_hash!==null)fail('historical skill stage/version');}
 for(const x of [...v.corrections,...v.skill_edits]){keys(x,['row_id','scope']);locate(x.row_id);if(!text(x.scope))fail('correction scope');}
 for(const a of v.acceptance){keys(a,['predicate','state','evidence_rows']);if(!text(a.predicate)||!['supported','contradicted','unknown'].includes(a.state)||!Array.isArray(a.evidence_rows)||a.evidence_rows.some(id=>!evidenceIds.has(id))||(a.state!=='unknown'&&!a.evidence_rows.length))fail('acceptance references');}
 return c;
}
export function selectorInput(c,manifest,rows){validateEvaluationCase(c,manifest,rows);return structuredClone(c.inputs);}
