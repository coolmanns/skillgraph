import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import {extractHermesHistory} from '../src/adapters/hermes-history.js';
import {readSelectedHistory} from '../src/adapters/hermes-selection.js';
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
 assert.throws(()=>extractHermesHistory(opts),/scoped profile membership unavailable/);
 const before=fs.readFileSync(opts.stateDbPath);
 assert.throws(()=>extractHermesHistory({...opts,bounds:null}),/scoped profile membership unavailable/);
 assert.deepEqual(fs.readFileSync(opts.stateDbPath),before);
});
test('profile-aware bounded and date-only controls exclude other and NULL profiles',()=>{
 for(const profile of ['default','other',null]){
  const opts=fixture(`profile-${profile}`,{profile,resultTime:1792012415.5});
  for(const bounds of [opts.bounds,null]){
   const out=extractHermesHistory({...opts,bounds});
   assert.equal(out.events.filter(e=>e.event_type==='tool.attempt').length,profile==='default'?1:0);
  }
 }
});
test('legacy unbounded extraction explicitly retains missing-profile compatibility',()=>{
 const opts=fixture('legacy',{profileColumn:false,resultTime:1792012415.5});
 const out=extractHermesHistory({...opts,bounds:null,since:null,until:null});
 assert.equal(out.events.find(e=>e.event_type==='tool.attempt').payload.status,'succeeded');
});
for(const selected of [false,true]){
 const mode=selected?'selected':'bounded';
 for(const [label,resultTime,inside] of [
  ['iso-since','2026-10-14T21:13:35.000Z',true],
  ['iso-until','2026-10-14T21:13:36.000Z',false],
  ['offset-until','2026-10-14T16:13:36.000-05:00',false],
  ['numeric-seconds',1792012415.5,true],
  ['numeric-ms',1792012415500,true],
  ['text-seconds','1792012415.5',true],
  ['text-ms','1792012415500',true],
  ['subms-before-since','1792012414.999999999999',false],
  ['subms-before-until','1792012415.999999999999',true],
  ['iso-subms-before-until','2026-10-14T21:13:35.999999999999Z',true],
  ['numeric-subms-before-until',1792012415.9999,true],
  ['text-ms-before-until','1792012415999.999999',true],
  ['exponent-until','1.792012416e9',false],
  ['invalid','not-a-date',false],
  ['zone-missing','2026-10-14T21:13:35',false],
  ['invalid-day','2026-02-30T21:13:35Z',false],
  ['null',null,false],
  ['blob',Buffer.from('1792012415'),false],
 ])test(`${mode}: exact source time ${label}`,()=>{
  const opts=fixture(`${mode}-${label}`,{resultTime});
  const before=fs.readFileSync(opts.stateDbPath);
  const out=extractHermesHistory({...opts,...(selected?{sessionIds:[sid]}:{})});
  assert.equal(out.sourceReadBounds.rowsRead,inside?2:1);
  assert.equal(out.events.find(e=>e.event_type==='tool.attempt').payload.status,inside?'succeeded':'unknown');
  assert.deepEqual(fs.readFileSync(opts.stateDbPath),before);
 });
 test(`${mode}: eligible submillisecond call survives event-time rounding`,()=>{
  const opts=fixture(`${mode}-subms-call`,{resultTime:1792012416});
  const db=new Database(opts.stateDbPath);db.prepare('UPDATE messages SET timestamp=? WHERE id=100').run(1792012415.9999);db.close();
  const out=extractHermesHistory({...opts,...(selected?{sessionIds:[sid]}:{})});
  assert.equal(out.sourceReadBounds.rowsRead,1);
  assert.equal(out.events.filter(e=>e.event_type==='tool.attempt').length,1);
 });
 test(`${mode}: submillisecond boundaries are not rounded`,()=>{
  const opts=fixture(`${mode}-subms-bounds`,{resultTime:'1792012415.99995'});
  const out=extractHermesHistory({...opts,since:'1792012415.9999',until:'2026-10-14T21:13:35.99999Z',...(selected?{sessionIds:[sid]}:{})});
  assert.equal(out.sourceReadBounds.rowsRead,1);
 });
}
test('selected SQL does not evaluate excluded bodies before exact time filtering',()=>{
 const db=new Database(':memory:');
 try {
  db.exec(`CREATE TABLE sessions(id TEXT,started_at REAL,profile_name TEXT);
   CREATE TABLE raw(id INTEGER PRIMARY KEY, session_id TEXT, timestamp);
   CREATE VIEW messages AS SELECT id,session_id,timestamp,'tool' AS role,'call' AS tool_call_id,'terminal' AS tool_name,body(id) AS content,NULL AS tool_calls FROM raw;`);
  db.prepare('INSERT INTO sessions VALUES (?,1,?)').run(sid,'default');
  const insert=db.prepare('INSERT INTO raw VALUES (?,?,?)');
  insert.run(1,sid,'2026-10-14T21:13:35.999999Z');
  insert.run(2,sid,'2026-10-14T21:13:36.000Z');
  insert.run(3,sid,'2026-10-14T21:13:34.999999Z');
  insert.run(4,sid,'invalid');
  const touched=[];
  db.function('body',id=>{touched.push(id);assert.equal(id,1,'excluded body was evaluated');return '{"exit_code":0}';});
  const out=readSelectedHistory(db,{sessionIds:[sid],sinceMs:1792012415000,untilMs:1792012416000,bounds:{rowLimit:10,maxFieldBytes:1024,pageSize:1}});
  assert.equal(out.sourceReadBounds.rowsRead,1);assert.ok(touched.length>0);
  assert.deepEqual([...new Set(touched)],[1]);
 } finally {db.close();}
});
test('invalid boundary dates and unbounded precision fail explicitly',()=>{
 const opts=fixture('invalid-boundary',{resultTime:1792012415.5});
 assert.equal(extractHermesHistory(opts).sourceReadBounds.rowsRead,2);
 for(const since of ['2026-02-30T00:00:00Z','2026-10-14T21:13:35','1e999','1'.repeat(129),new Date(NaN)]){
  assert.throws(()=>extractHermesHistory({...opts,since}),/since must be a valid date-time or epoch value/);
 }
});
test.after(()=>{fs.rmSync(root,{recursive:true,force:true});});
