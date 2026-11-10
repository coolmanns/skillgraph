import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import {extractHermesHistory} from '../src/adapters/hermes-history.js';
const sid='20000101_000000_aaaaaa';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'collector-parent-boundaries-'));
function fixture(label,{profileColumn=true,profile='default',resultTime='2026-10-14T21:13:36.000Z'}={}){
 const file=path.join(root,label+'.db'); const db=new Database(file);
 db.exec(`CREATE TABLE sessions(id TEXT,started_at REAL${profileColumn?',profile_name TEXT':''});CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,tool_calls TEXT,tool_call_id TEXT,tool_name TEXT,timestamp);`);
 if(profileColumn)db.prepare('INSERT INTO sessions VALUES (?,1,?)').run(sid,profile);else db.prepare('INSERT INTO sessions VALUES (?,1)').run(sid);
 const put=db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)');
 put.run(100,sid,'assistant',null,JSON.stringify([{id:'call',function:{name:'terminal',arguments:'{"command":"synthetic-not-executed"}'}}]),null,null,1792012415);
 put.run(101,sid,'tool','{"exit_code":0}',null,'call','terminal',resultTime);db.close();
 return {stateDbPath:file,sourceInstanceId:'11111111-1111-4111-8111-111111111111',hmacKey:'synthetic-parent-boundary-key-0000000001',pseudonymKeyVersion:'test-v1',since:'2026-10-14T21:13:35.000Z',until:'2026-10-14T21:13:36.000Z',bounds:{sessionLimit:5,rowLimit:10,maxFieldBytes:1024}};
}
test('control: numeric exclusive-boundary result is excluded',()=>{
 const out=extractHermesHistory({...fixture('numeric',{resultTime:1792012416}),sessionIds:[sid]});
 assert.equal(out.sourceReadBounds.rowsRead,1);assert.equal(out.events.find(e=>e.event_type==='tool.attempt').payload.status,'unknown');
});
test('ISO exclusive-boundary result must not influence status',()=>{
 const out=extractHermesHistory({...fixture('iso'),sessionIds:[sid]});
 assert.equal(out.sourceReadBounds.rowsRead,1);assert.equal(out.events.find(e=>e.event_type==='tool.attempt').payload.status,'unknown');
});
test('bounded extraction fails closed when profile membership cannot be established',()=>{
 const opts=fixture('missing-profile',{profileColumn:false,resultTime:1792012415.5});
 assert.throws(()=>extractHermesHistory(opts));
});
test.after(()=>{fs.rmSync(root,{recursive:true,force:true});});
