import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { extractHermesHistory } from '../src/adapters/hermes-history.js';

test('bounded history reads only selected recent rows and caps payloads in SQL', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-bounds-'));
  const file = path.join(dir, 'state.db');
  const db = new Database(file);
  db.exec(`CREATE TABLE sessions(id TEXT, started_at REAL, profile_name TEXT);
    CREATE TABLE messages(id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT,
      tool_calls TEXT, tool_call_id TEXT, tool_name TEXT, timestamp REAL);
    INSERT INTO sessions VALUES ('old',1,'default'),('new',2,'default');`);
  const put = db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)');
  put.run(1,'old','tool','{"success":true}',null,'old-call','terminal',1);
  put.run(2,'new','user','private context',null,null,null,2);
  put.run(3,'new','tool','{"success":true}',null,'new-call','terminal',3);
  put.run(4,'new','tool','x'.repeat(10000),null,'oversize','terminal',4);
  db.close();
  const before = fs.readFileSync(file);
  const options = {stateDbPath:file,sourceInstanceId:'11111111-1111-4111-8111-111111111111',
    hmacKey:'test-only-bounded-collector-key-000000001',pseudonymKeyVersion:'test-v1',
    bounds:{sessionLimit:1,rowLimit:2,maxFieldBytes:1024}};
  try {
    const r = extractHermesHistory(options);
    assert.equal(r.batchMetadata.runtime_version,'unknown','current installation cannot date historical runtime versions');
    assert.deepEqual(r.sourceReadBounds, {sessionLimit:1,rowLimit:2,maxFieldBytes:1024,
      sessionsRead:1,rowsRead:2,oversizedFields:1,coverage:'bounded_tail_not_complete_history'});
    assert.equal(r.stats.attempts_emitted,0); // Orphan results cannot invent attempts.
    assert.equal(r.events.some(e => JSON.stringify(e).includes('private context')),false);
    assert.deepEqual(extractHermesHistory(options).events,r.events);
    assert.deepEqual(fs.readFileSync(file),before);
    assert.throws(()=>extractHermesHistory({...options,bounds:{sessionLimit:0,rowLimit:2,maxFieldBytes:1024}}),/bounds/);
    const edit = new Database(file);
    edit.exec(`INSERT INTO sessions VALUES ('other',99,'unapproved-profile');
      INSERT INTO messages VALUES (5,'other','tool','{}',NULL,'other-call','terminal',99);`);
    edit.close();
    assert.equal(extractHermesHistory(options).sourceReadBounds.rowsRead,2);
  } finally { fs.rmSync(dir,{recursive:true}); }
});
