import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { extractHermesHistory } from '../src/adapters/hermes-history.js';
import { classifyOperation } from '../src/classifiers.js';
import { TEST_HMAC_KEY, testHmac } from './helpers.js';

function classify(args, call = 'first') {
  return classifyOperation('patch', args, { hmacKey: TEST_HMAC_KEY, perCallHmac: testHmac(call) });
}
const replacement = { mode: 'replace', path: '/synthetic/a.js', old_string: 'old', new_string: 'new', replace_all: false };

test('extraction groups equivalent patch retries, separates edits and replays without source mutation', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'patch-retries-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'state.db'),db=new Database(file);
  db.exec(`CREATE TABLE sessions(id TEXT,started_at REAL,profile_name TEXT);
    INSERT INTO sessions VALUES ('synthetic',1,'default');
    CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,tool_calls TEXT,tool_call_id TEXT,tool_name TEXT,timestamp REAL);
    INSERT INTO messages VALUES(1,'synthetic','user','Synthetic request',NULL,NULL,NULL,1);`);
  const insert=db.prepare("INSERT INTO messages VALUES (?,'synthetic','assistant',NULL,?,NULL,NULL,2)");
  const args=[replacement,{path:replacement.path,old_string:'old',new_string:'new'},
    {...replacement,new_string:'different'}, {path:replacement.path},{path:replacement.path}];
  args.forEach((a,i)=>insert.run(i+2,JSON.stringify([{id:`call-${i}`,function:{name:'patch',arguments:JSON.stringify(a)}}])));
  // Same native ID replay with identical intent is still one reduced call.
  insert.run(7,JSON.stringify([{id:'call-0',function:{name:'patch',arguments:JSON.stringify(replacement)}}]));
  db.close();const before=fs.readFileSync(file);
  const options={stateDbPath:file,sourceInstanceId:'11111111-1111-4111-8111-111111111111',hmacKey:TEST_HMAC_KEY,pseudonymKeyVersion:'test-v1',bounds:{sessionLimit:1,rowLimit:20,maxFieldBytes:4096}};
  const out=extractHermesHistory(options),ops=out.events.filter(e=>e.event_type==='tool.operation');
  assert.equal(ops.length,5);assert.equal(out.quarantined.length,0);
  assert.equal(ops[0].payload.episode_operation_key,ops[1].payload.episode_operation_key);
  assert.notEqual(ops[0].payload.episode_operation_key,ops[2].payload.episode_operation_key);
  assert.notEqual(ops[3].payload.episode_operation_key,ops[4].payload.episode_operation_key);
  assert.deepEqual(extractHermesHistory(options).events,out.events);
  assert.deepEqual(fs.readFileSync(file),before);
});

test('equivalent explicit defaults and legacy replacement aliases share retry identity', () => {
  const expected = classify(replacement).episodeOperationSignature;
  for (const args of [
    { path: replacement.path, old_string: 'old', new_string: 'new' },
    { file_path: replacement.path, old_text: 'old', new_text: 'new' },
    { path: replacement.path, oldText: 'old', newText: 'new' },
    { new_string: 'new', old_string: 'old', path: replacement.path, mode: 'replace', replace_all: false },
  ]) assert.equal(classify(args).episodeOperationSignature, expected);
});

test('patch payload and replacement modes have separate content-bound retry identities', () => {
  const a = classify({ mode: 'patch', patch: 'synthetic patch A' });
  const b = classify({ mode: 'patch', patch: 'synthetic patch B' });
  assert.equal(a.groupable, true);assert.equal(b.groupable, true);
  assert.notEqual(a.episodeOperationSignature,b.episodeOperationSignature);
  assert.notEqual(a.episodeOperationSignature,classify(replacement).episodeOperationSignature);
  assert.equal(a.episodeOperationSignature,classify({ patch: 'synthetic patch A' }).episodeOperationSignature);
  assert.equal(a.episodeOperationSignature,classify({ diff: 'synthetic patch A' }).episodeOperationSignature);
});

for (const [label,args] of [
  ['null',null],['path-only',{path:replacement.path}],['array',[]],
  ['missing-path',{old_string:'old',new_string:'new'}],
  ['missing-new',{path:replacement.path,old_string:'old'}],
  ['empty-old',{...replacement,old_string:''}],
  ['numeric-new',{...replacement,new_string:2}],
  ['bad-bool',{...replacement,replace_all:'false'}],
  ['bad-mode',{...replacement,mode:'append'}],
  ['mixed-mode',{...replacement,mode:'patch'}],
  ['mixed-payload',{...replacement,patch:'different intent'}],
  ['conflicting-paths',{...replacement,file_path:'/synthetic/b.js'}],
  ['conflicting-aliases',{...replacement,old_text:'other',new_text:'new'}],
  ['truncated',{...replacement,new_string:'...[truncated]'}],
  ['unknown-field',{...replacement,unknown_option:true}],
  ['empty-patch',{mode:'patch',patch:''}],
  ['patch-bool',{mode:'patch',patch:'payload',replace_all:true}],
])test(`malformed patch is not groupable: ${label}`,()=>{
  const out=classify(args);
  assert.equal(out.groupable,false);
  assert.equal(out.episodeOperationSignature,null);
});

test('patch retry identity includes exact replacement and replace_all intent', () => {
  const first = classify(replacement);
  assert.equal(first.groupable, true);
  assert.equal(first.episodeOperationSignature, classify({ ...replacement }, 'retry').episodeOperationSignature);
  for (const change of [{ old_string: 'different' }, { new_string: 'different' }, { new_string: '' }, { replace_all: true }]) {
    const other = classify({ ...replacement, ...change });
    assert.equal(other.groupable, true);
    assert.notEqual(first.episodeOperationSignature, other.episodeOperationSignature);
    assert.equal(first.operationSignature, other.operationSignature, 'coarse path analytics are not retry identity');
  }
});
