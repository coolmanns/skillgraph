import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {extractHermesHistory} from '../src/adapters/hermes-history.js';
const id='20000101_000000_aaaaaa';
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'selection-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'state.db'),db=new Database(file);
 db.exec(`CREATE TABLE sessions(id TEXT,started_at REAL,profile_name TEXT);CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,tool_calls TEXT,tool_call_id TEXT,tool_name TEXT,timestamp REAL,active INTEGER,compacted INTEGER);`);
 db.prepare('INSERT INTO sessions VALUES (?,1,?)').run(id,'default');
 const insert=db.prepare('INSERT INTO messages VALUES (?,?,?, ?,NULL,NULL,NULL,?,1,0)');
 for(let i=1;i<=6;i++)insert.run(i,id,'user','PRIVATE_SENTINEL',i);
 db.close();return file;
}
function extract(file,extra={}){return extractHermesHistory({stateDbPath:file,sourceInstanceId:'11111111-1111-4111-8111-111111111111',hmacKey:'test-only-hermes-extractor-key-0000000001',pseudonymKeyVersion:'test-v1',sessionIds:[id],since:2000,until:5000,bounds:{sessionLimit:5,rowLimit:10,maxFieldBytes:1024,pageSize:2},...extra});}
test('explicit old-start session reads only bounded timestamp rows with paginated coverage',t=>{
 const out=extract(fixture(t),{since:new Date(2000),until:new Date(5000)});
 assert.equal(out.sourceReadBounds.coverage,'explicit_selection');
 assert.equal(out.sourceSchemaVersion,'hermes-state-0');
 assert.equal(out.sourceReadBounds.sessions[0].rowsRead,3);
 assert.equal(out.sourceReadBounds.sessions[0].pages,2);
 assert.equal(out.sourceReadBounds.sessions[0].omittedRows,0);
 assert.equal(JSON.stringify(out.events).includes('PRIVATE_SENTINEL'),false);
});
test('generic date filter also bounds body reads before extraction',t=>{
 const out=extract(fixture(t),{sessionIds:null,since:new Date(2000),until:new Date(5000)});
 assert.equal(out.sourceReadBounds.rowsRead,3);
});
test('selection rejects unknown, malformed and cross-profile IDs',t=>{
 const file=fixture(t),db=new Database(file);db.prepare('INSERT INTO sessions VALUES (?,1,?)').run('20000101_000001_bbbbbb','other');db.close();
 for(const bad of ['bad','20000101_000001_bbbbbb','20000101_000002_cccccc'])assert.throws(()=>extract(file,{sessionIds:[bad]}));
});
test('per-session limit reports omission',t=>{
 const out=extract(fixture(t),{since:new Date(0),until:new Date(7000),bounds:{rowLimit:2,maxFieldBytes:1024,pageSize:1}});
 assert.equal(out.sourceReadBounds.sessions[0].omittedRows,4);
 assert.equal(out.sourceReadBounds.sessions[0].pages,2);
});
test('selected compaction replay is stable, conflicts retained, tool success is not outcome',t=>{
 const file=fixture(t),db=new Database(file);
 const call=JSON.stringify([{id:'same',type:'function',function:{name:'terminal',arguments:'{"command":"PRIVATE_SENTINEL"}'}}]);
 db.prepare('UPDATE messages SET role=?,tool_calls=? WHERE id in (2,3)').run('assistant',call);
 db.prepare('UPDATE messages SET role=?,tool_call_id=?,tool_name=?,content=? WHERE id in (4,5)').run('tool','same','terminal','{"exit_code":0}');
 db.close();
 const opts={since:new Date(0),until:new Date(7000)};
 const a=extract(file,opts),b=extract(file,opts);assert.deepEqual(a.events,b.events);
 assert.equal(a.stats.attempts_emitted,1);assert.equal(a.events.some(e=>e.event_type==='outcome.assessed'),false);
 const change=new Database(file);change.prepare('UPDATE messages SET content=? WHERE id=5').run('{"exit_code":1}');change.close();
 assert.equal(extract(file,opts).quarantined.length,1);
});
