import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  HERMES_CLASSIFIER_HASH,
  classifyOperation,
} from '../src/classifiers.js';
import {
  HERMES_HISTORY_ADAPTER_BUILD_HASH,
  HERMES_HISTORY_ADAPTER_VERSION,
} from '../src/adapters/hermes-history.js';
import { sha256Bytes } from '../src/hashes.js';
import { TEST_HMAC_KEY, testHmac } from './helpers.js';

function classify(toolName, args) {
  return classifyOperation(toolName, args, {
    hmacKey: TEST_HMAC_KEY,
    perCallHmac: testHmac('classifier-per-call'),
  });
}

test('classifier and adapter provenance are bound to exact implementation bytes', () => {
  const classifierPath = fileURLToPath(new URL('../src/classifiers.js', import.meta.url));
  assert.equal(HERMES_CLASSIFIER_HASH, sha256Bytes(fs.readFileSync(classifierPath)));
  assert.match(HERMES_HISTORY_ADAPTER_BUILD_HASH, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    HERMES_HISTORY_ADAPTER_VERSION,
    `0.1.0+${HERMES_HISTORY_ADAPTER_BUILD_HASH.slice(7, 23)}`,
  );
});

test('episode operation keys use allowlisted stable fields while coarse signatures never drive retries', () => {
  const terminalA = classify('terminal', { command: 'npm test', timeout: 10 });
  const terminalB = classify('terminal', { command: 'npm test', timeout: 60, cursor: 'volatile' });
  assert.equal(terminalA.episodeOperationSignature, terminalB.episodeOperationSignature);
  assert.equal(terminalA.operationSignature, terminalB.operationSignature);

  const searchA = classify('search_files', { path: '/repo', query: 'alpha', limit: 10 });
  const searchB = classify('search_files', { path: '/repo', query: 'beta', limit: 10 });
  assert.equal(searchA.operationSignature, searchB.operationSignature, 'coarse analytics signature may share a scope');
  assert.notEqual(searchA.episodeOperationSignature, searchB.episodeOperationSignature, 'retry key must include query intent');

  // Patch payloads require explicit patch mode; missing mode means replace.
  const patchA = classify('patch', { mode: 'patch', path: '/repo/a.js', patch: 'old -> first' });
  const patchB = classify('patch', { mode: 'patch', path: '/repo/a.js', patch: 'old -> second' });
  assert.equal(patchA.groupable, true);
  assert.equal(patchB.groupable, true);
  assert.ok(patchA.episodeOperationSignature);
  assert.ok(patchB.episodeOperationSignature);
  assert.equal(patchA.operationSignature, patchB.operationSignature);
  assert.notEqual(patchA.episodeOperationSignature, patchB.episodeOperationSignature);

  const unknown = classify('custom_private_tool', { secret_action: 'value' });
  assert.equal(unknown.operationSignature, null);
  assert.equal(unknown.episodeOperationSignature, null);
  assert.equal(unknown.groupable, false);
});
