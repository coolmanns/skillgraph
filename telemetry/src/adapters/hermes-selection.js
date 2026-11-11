import { registerHistoryTime } from './hermes-time.js';

// Explicit selection is fail-closed. All discovery precedes any body read.
export function readSelectedHistory(db,{sessionIds,sinceMs,untilMs,bounds}) {
 if(!Array.isArray(sessionIds)||!sessionIds.length||sessionIds.length>100||sessionIds.some(id=>typeof id!=='string'||!/^\d{8}_\d{6}_[0-9a-f]{6}$/.test(id)))throw new Error('invalid literal session ID allowlist');
 if(new Set(sessionIds).size!==sessionIds.length)throw new Error('duplicate session ID');
 if(sinceMs===null||untilMs===null)throw new Error('explicit selection requires both date bounds');
 const {rowLimit,maxFieldBytes,pageSize=250}=bounds??{};
 if(![rowLimit,maxFieldBytes,pageSize].every(Number.isSafeInteger)||rowLimit<1||rowLimit>10000||pageSize<1||pageSize>1000||maxFieldBytes<1024||maxFieldBytes>1048576)throw new Error('invalid selection bounds');
 const columns=new Set(db.prepare('PRAGMA table_info(sessions)').all().map(x=>x.name));
 if(!columns.has('profile_name'))throw new Error('explicit profile membership unavailable');
 const sessions=sessionIds.map(id=>{
  const row=db.prepare(`SELECT id,started_at,profile_name,${columns.has('ended_at')?'ended_at':'NULL AS ended_at'},${columns.has('model')?'model':'NULL AS model'},${columns.has('billing_provider')?'billing_provider':'NULL AS billing_provider'} FROM sessions WHERE id=?`).get(id);
  if(!row||row.profile_name!=='default')throw new Error(`session unavailable in default profile: ${id}`);
  return row;
 });
 // Numeric Hermes timestamps are seconds (or milliseconds); ISO text is supported.
 registerHistoryTime(db,sinceMs,untilMs);
 const time='collector_time_ms(m.timestamp)';
 const where="m.session_id=? AND s.profile_name='default' AND collector_in_window(m.timestamp)=1";
 const join='messages m JOIN sessions s ON s.id=m.session_id';
 const messageColumns=new Set(db.prepare('PRAGMA table_info(messages)').all().map(x=>x.name));
 const optional=name=>messageColumns.has(name)?`m.${name}`:`0 AS ${name}`;
 const field=name=>`CASE WHEN length(CAST(m.${name} AS BLOB))<=${maxFieldBytes} THEN m.${name} ELSE NULL END AS ${name}`;
 const rows=[],coverage=[];
 for(const session of sessions){
  const args=[session.id];
  const available=db.prepare(`SELECT count(*) n, min(${time}) first_ms,max(${time}) last_ms FROM ${join} WHERE ${where}`).get(...args);
  let cursor=-1,pages=0,read=0,oversized=0;
  while(read<Math.min(rowLimit,available.n)){
   const page=db.prepare(`SELECT m.id,m.session_id,m.role,m.tool_call_id,m.tool_name,m.timestamp,${optional('active')},${optional('compacted')},${optional('effect_disposition')},${field('content')},${field('tool_calls')}, (CASE WHEN length(CAST(m.content AS BLOB))>${maxFieldBytes} THEN 1 ELSE 0 END + CASE WHEN length(CAST(m.tool_calls AS BLOB))>${maxFieldBytes} THEN 1 ELSE 0 END) oversized FROM ${join} WHERE ${where} AND m.id>? ORDER BY m.id LIMIT ?`).all(...args,cursor,Math.min(pageSize,rowLimit-read));
   if(!page.length)break;
   pages++;read+=page.length;cursor=page.at(-1).id;oversized+=page.reduce((n,r)=>n+r.oversized,0);rows.push(...page);
  }
  coverage.push({sessionId:session.id,profile:'default',availableRows:available.n,rowsRead:read,omittedRows:available.n-read,truncated:read<available.n,pages,lastRowId:cursor,firstTimestampMs:available.first_ms,lastTimestampMs:available.last_ms,oversizedFields:oversized});
 }
 return {callRows:rows.filter(r=>r.role==='assistant'&&r.tool_calls!==null),resultRows:rows.filter(r=>r.role==='tool'&&r.tool_call_id!==null),userRows:rows.filter(r=>r.role==='user'),sessions,sourceReadBounds:{coverage:'explicit_selection',rowLimit,maxFieldBytes,pageSize,sessionsRead:sessions.length,rowsRead:rows.length,oversizedFields:coverage.reduce((n,s)=>n+s.oversizedFields,0),sessions:coverage}};
}
