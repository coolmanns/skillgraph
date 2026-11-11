// Acceptance gate for Kanban card t_11313602, retained blocker R3 (see docs/COLLECTOR-REPAIRS.md).
// EXPECTED RED until R3 is fixed. Runs as the separate CI "acceptance" job; it is deliberately
// excluded from `npm test` (regression suite) so known failures cannot hide new regressions.
// Never skip, todo, or wrap these as expected failures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOperation } from '../../src/classifiers.js';
import { reduceHermesToolRows } from '../../src/hermes-reducer.js';
import { TEST_HMAC_KEY } from '../helpers.js';

const SOURCE = '11111111-1111-4111-8111-111111111111';
const complete = { mode: 'replace', path: '/synthetic/review.txt', old_string: 'old', new_string: 'new', replace_all: false };

// Several retained representations of ONE native tool call (same session and native ID).
function reduceSameNativeId(representations) {
  return reduceHermesToolRows({
    sourceInstanceId: SOURCE,
    hmacKey: TEST_HMAC_KEY,
    callRows: representations.map((args, i) => ({
      id: 10 + i,
      session_id: 'synthetic',
      timestamp: 1767225600,
      tool_calls: JSON.stringify([{ id: 'same-native-id', function: { name: 'patch', arguments: JSON.stringify(args) } }]),
    })),
    resultRows: [],
  });
}

test('R3 control: identical duplicate representations reduce to one call', () => {
  const out = reduceSameNativeId([complete, { ...complete }]);
  assert.equal(out.reduced.length, 1);
  assert.equal(out.quarantined.length, 0);
});

test('R3 control: a compacted representation missing fields reduces to the complete one', () => {
  const compacted = { path: complete.path };
  const out = reduceSameNativeId([compacted, complete]);
  assert.equal(out.reduced.length, 1);
  assert.equal(out.quarantined.length, 0);
  assert.equal(out.reduced[0].transientArguments.new_string, 'new');
});

test('R3: two complete, conflicting patch intents under one native ID are quarantined, not silently merged', () => {
  const variant = { ...complete, new_string: 'different edit' };
  const sig = (args) => classifyOperation('patch', args, { hmacKey: TEST_HMAC_KEY, perCallHmac: 'synthetic' }).episodeOperationSignature;
  assert.notEqual(sig(complete), sig(variant), 'fixture precondition: the two intents are distinct operations');

  const out = reduceSameNativeId([complete, variant]);
  assert.equal(out.quarantined.length, 1, 'conflicting complete intents must be quarantined');
  assert.equal(out.reduced.length, 0, 'no variant may be silently chosen');
});
