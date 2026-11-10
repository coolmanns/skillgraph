import {hmacSha256} from './hashes.js';
import {canonicalize} from './canonical-json.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function parsed(value) {
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; }
}

// Derived identity interpretation only. Never changes reducer inputs or immutable events.
// Runtime provenance: agent/tool_executor.py:_unwrap_tool_search_call preserves the
// transcript wrapper and pairing ID while downstream hooks see the concrete tool.
export function deriveWrapperAttribution({callRows,resultRows,sourceInstanceId,hmacKey}) {
  if (!sourceInstanceId || !hmacKey) throw new Error('source and key required');
  const groups=new Map();
  const group=(session,id)=>{
    const key=JSON.stringify([session,id]);
    if(!groups.has(key))groups.set(key,{session,id,calls:[],results:[]});
    return groups.get(key);
  };
  for(const row of callRows) {
    const raw=parsed(row.tool_calls);
    for(const c of (Array.isArray(raw)?raw:object(raw)?[raw]:[])) {
      if (!object(c)) continue;
      const id=c.id??c.call_id??c.response_item_id;
      if(typeof id==='string' && id && typeof row.session_id==='string')
        group(row.session_id,id).calls.push({row,c});
    }
  }
  for(const row of resultRows) if(typeof row.tool_call_id==='string' && row.tool_call_id && typeof row.session_id==='string')group(row.session_id,row.tool_call_id).results.push(row);
  const records=[];
  for(const g of groups.values()) {
    const names=new Set([...g.calls.map(x=>x.c.function?.name??x.c.name),...g.results.map(x=>x.tool_name).filter(Boolean)]);
    if(names.size<2)continue;
    let valid=!!g.calls.length && !!g.results.length;
    const nested=[];
    for(const {c} of g.calls) {
      const a=parsed(c.function?.arguments??c.arguments);
      const one=object(a)&&Array.isArray(a.calls)&&a.calls.length===1?a.calls[0]:null;
      // Hermes stores id == call_id, but response_item_id is a separate fc_ ID:
      // agent/chat_completion_helpers.py:1603-1611 and codex_responses_adapter.py:1160-1171.
      const aliases=[c.id,c.call_id,c.response_item_id].filter(x=>x!==undefined&&x!==null);
      const identityValid=new Set(aliases).size===1 || (typeof c.id==='string'&&c.id===c.call_id&&typeof c.response_item_id==='string'&&/^fc_[A-Za-z0-9_-]+$/.test(c.response_item_id));
      valid &&= (c.function?.name??c.name)==='tool_call' && identityValid
        && object(one) && typeof one.name==='string' && /^[A-Za-z][A-Za-z0-9_]{0,199}$/.test(one.name) && object(one.arguments);
      nested.push(one);
    }
    valid &&= new Set(g.calls.map(x=>x.c.response_item_id).filter(x=>x!==undefined&&x!==null)).size<=1
      && nested.every(x=>canonicalize(x)===canonicalize(nested[0]))
      && g.results.every(r=>r.tool_name===nested[0]?.name)
      && [...g.calls.map(x=>x.row.id),...g.results.map(x=>x.id)].every(Number.isSafeInteger);
    records.push({contract:'hermes-wrapper-attribution.v1',source_instance_id:sourceInstanceId,
      subject_key_hmac:hmacSha256({namespace:'hermes-tool-call-v0',sourceInstanceId,sessionId:g.session,toolCallId:g.id},hmacKey),
      session_hmac:hmacSha256({namespace:'wrapper-review-session-v1',sourceInstanceId,sessionId:g.session},hmacKey),
      row_ids:[...new Set([...g.calls.map(x=>x.row.id),...g.results.map(x=>x.id)])].sort((a,b)=>a-b),
      status:valid?'resolved':'unresolved',rule:valid?'single-deferred-native-id.v1':null,
      concrete_tool_hmac:valid?hmacSha256({namespace:'wrapper-concrete-tool-v1',name:nested[0].name},hmacKey):null,
      scope:'name-attribution-only-not-result-equivalence-or-task-acceptance'});
  }
  return records.sort((a,b)=>a.subject_key_hmac.localeCompare(b.subject_key_hmac));
}
