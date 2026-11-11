// Regression tests for Kanban card t_11313602 blocker R3 (see docs/COLLECTOR-REPAIRS.md):
// several retained representations of ONE native tool call (same session and native ID) must
// reduce to one call only when they agree. A field present in only one representation
// (compaction) or a value carrying the known truncation marker is not a disagreement; any other
// disagreement on a shared field quarantines the identity instead of silently choosing one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOperation } from '../src/classifiers.js';
import { reduceHermesToolRows } from '../src/hermes-reducer.js';
import { TEST_HMAC_KEY } from './helpers.js';

const SOURCE = '11111111-1111-4111-8111-111111111111';
const complete = { mode: 'replace', path: '/synthetic/review.txt', old_string: 'old', new_string: 'new', replace_all: false };

function reduceSameNativeId(representations, toolName = 'patch') {
  return reduceHermesToolRows({
    sourceInstanceId: SOURCE,
    hmacKey: TEST_HMAC_KEY,
    callRows: representations.map((args, i) => ({
      id: 10 + i,
      session_id: 'synthetic',
      timestamp: 1767225600,
      tool_calls: JSON.stringify([{ id: 'same-native-id', function: { name: toolName, arguments: JSON.stringify(args) } }]),
    })),
    resultRows: [],
  });
}

function assertReducedOnce(out) {
  assert.equal(out.quarantined.length, 0, 'no quarantine expected');
  assert.equal(out.reduced.length, 1);
}

function assertPayloadConflict(out) {
  assert.equal(out.reduced.length, 0, 'no variant may be silently chosen');
  assert.equal(out.quarantined.length, 1, 'conflicting intents must be quarantined');
  assert.equal(out.quarantined[0].code, 'material_variant_conflict');
  assert.ok(out.quarantined[0].conflict_fields.includes('operation_payload'), out.quarantined[0].conflict_fields.join(','));
}

const sig = (args) => classifyOperation('patch', args, { hmacKey: TEST_HMAC_KEY, perCallHmac: 'synthetic' }).episodeOperationSignature;

// --- controls: agreement and harmless compaction still reduce to one call ---

test('R3 control: identical duplicate representations reduce to one call', () => {
  assertReducedOnce(reduceSameNativeId([complete, { ...complete }]));
});

test('R3 control: a compacted representation missing fields reduces to the complete one', () => {
  const out = reduceSameNativeId([{ path: complete.path }, complete]);
  assertReducedOnce(out);
  assert.equal(out.reduced[0].transientArguments.new_string, 'new');
});

test('R3 control: a truncated value is a compaction variant, not a conflict', () => {
  const out = reduceSameNativeId([{ ...complete, new_string: 'ne...[truncated]' }, complete]);
  assertReducedOnce(out);
  assert.equal(out.reduced[0].transientArguments.new_string, 'new');
});

test('R3 control: key order and an explicit default do not create a conflict', () => {
  const { replace_all: _omitted, ...withoutDefault } = complete;
  const reordered = Object.fromEntries(Object.entries(complete).reverse());
  assertReducedOnce(reduceSameNativeId([withoutDefault, reordered]));
});

test('R3 control: a compacted read_file representation missing optional fields reduces', () => {
  assertReducedOnce(reduceSameNativeId([{ path: '/synthetic/a.txt' }, { path: '/synthetic/a.txt', offset: 10 }], 'read_file'));
});

// --- R3: genuine disagreements are quarantined ---

test('R3: two complete, conflicting patch intents under one native ID are quarantined, not silently merged', () => {
  const variant = { ...complete, new_string: 'different edit' };
  assert.notEqual(sig(complete), sig(variant), 'fixture precondition: the two intents are distinct operations');
  assertPayloadConflict(reduceSameNativeId([complete, variant]));
});

test('R3: replace_all disagreement is a conflict, including against the implicit default', () => {
  assertPayloadConflict(reduceSameNativeId([complete, { ...complete, replace_all: true }]));
  const { replace_all: _omitted, ...implicitFalse } = complete;
  assertPayloadConflict(reduceSameNativeId([implicitFalse, { ...complete, replace_all: true }]));
});

test('R3: disagreement through a legacy alias is a conflict', () => {
  const { old_string: _omitted, ...rest } = complete;
  assertPayloadConflict(reduceSameNativeId([complete, { ...rest, old_text: 'something else' }]));
});

test('R3: an incomplete representation that contradicts a shared field is a conflict', () => {
  assertPayloadConflict(reduceSameNativeId([{ path: complete.path, new_string: 'other' }, complete]));
});

test('R3: conflicts are detected for non-patch tools too', () => {
  assertPayloadConflict(reduceSameNativeId([{ command: 'ls -la' }, { command: 'rm -rf build' }], 'terminal'));
  assertPayloadConflict(reduceSameNativeId([{ path: '/synthetic/a.txt', offset: 1 }, { path: '/synthetic/a.txt', offset: 50 }], 'read_file'));
});

test('R3: a conflict anywhere among three representations is a conflict', () => {
  assertPayloadConflict(reduceSameNativeId([complete, { ...complete }, { ...complete, new_string: 'third' }]));
});

test('R3: the reducer does not mutate its input rows', () => {
  const rows = [complete, { ...complete, new_string: 'x' }].map((args, i) => ({
    id: 10 + i, session_id: 'synthetic', timestamp: 1767225600,
    tool_calls: JSON.stringify([{ id: 'same-native-id', function: { name: 'patch', arguments: JSON.stringify(args) } }]),
  }));
  const before = JSON.stringify(rows);
  reduceHermesToolRows({ sourceInstanceId: SOURCE, hmacKey: TEST_HMAC_KEY, callRows: rows, resultRows: [] });
  assert.equal(JSON.stringify(rows), before);
});

// --- independent review of 98e3bf3: alias, array and normalization cases ---

test('R3 review: a legacy alias on an incomplete representation is compared with the canonical field', () => {
  assertPayloadConflict(reduceSameNativeId([{ path: complete.path, old_text: 'OTHER' }, complete]));
  assertPayloadConflict(reduceSameNativeId([{ path: complete.path, new_text: 'OTHER' }, complete]));
  assertPayloadConflict(reduceSameNativeId([{ file_path: '/synthetic/other.txt' }, complete]));
  assertPayloadConflict(reduceSameNativeId([{ path: complete.path, diff: 'Y' }, { mode: 'patch', path: complete.path, patch: 'X' }]));
});

test('R3 review control: equal values under an alias and the canonical name still reduce', () => {
  assertReducedOnce(reduceSameNativeId([{ path: complete.path, old_text: 'old' }, complete]));
  assertReducedOnce(reduceSameNativeId([{ file_path: complete.path }, complete]));
});

test('R3 review: arrays are compared element by element; one truncated element exempts only itself', () => {
  assertPayloadConflict(reduceSameNativeId([{ items: ['DIFF', 'b...[truncated]'] }, { items: ['a', 'bc'] }], 'custom_tool'));
  assertPayloadConflict(reduceSameNativeId([{ items: ['a', 'b...[truncated]'] }, { items: ['a', 'bc', 'EXTRA'] }], 'custom_tool'));
  assertPayloadConflict(reduceSameNativeId([
    { edits: [{ old: 'a', new: 'X' }, { old: 'b...[truncated]' }] },
    { edits: [{ old: 'a', new: 'Y' }, { old: 'bb' }] },
  ], 'custom_tool'));
  assertPayloadConflict(reduceSameNativeId([{ items: ['a'] }, { items: ['a', 'b'] }], 'custom_tool'));
});

test('R3 review control: a truncated array element exempts only itself', () => {
  assertReducedOnce(reduceSameNativeId([{ items: ['a', 'b...[truncated]'] }, { items: ['a', 'bc'] }], 'custom_tool'));
});

test('R3 review control: normalizations of the older checks are not payload conflicts', () => {
  assertReducedOnce(reduceSameNativeId([{ name: 'caf\u00e9' }, { name: 'cafe\u0301' }], 'skill_view'));
  assertReducedOnce(reduceSameNativeId([{ name: 'x' }, { name: 'x ' }], 'skill_view'));
  assertReducedOnce(reduceSameNativeId([{ ...complete, mode: 'Replace' }, complete]));
});

test('R3 review: whitespace and case still matter outside the normalized fields', () => {
  assertPayloadConflict(reduceSameNativeId([{ command: 'rm -rf build' }, { command: 'rm -rf Build' }], 'terminal'));
  assertPayloadConflict(reduceSameNativeId([complete, { ...complete, new_string: 'new ' }]));
});

// --- re-review of fdcfe87: self-disagreeing aliases, tool-name normalization, normalization scope ---

test('R3 re-review: a representation whose own aliases disagree still conflicts with another on the same key', () => {
  assertPayloadConflict(reduceSameNativeId([
    { path: '/p', old_string: 'a', old_text: 'b', new_string: 'n' }, { path: '/p', old_text: 'a' }]));
  assertPayloadConflict(reduceSameNativeId([{ path: '/x', file_path: '/y' }, { file_path: '/x' }], 'read_file'));
  assertPayloadConflict(reduceSameNativeId([{ name: 'a', skill: 'b' }, { skill: 'a' }], 'skill_view'));
});

test('R3 re-review: aliases are resolved for the normalized tool name, as in the classifiers', () => {
  for (const name of ['Patch', ' patch', 'PATCH']) {
    assertPayloadConflict(reduceSameNativeId([{ path: complete.path, old_text: 'OTHER' }, complete], name));
  }
});

test('R3 re-review: NFC is applied only where the older checks normalize; replacement text is exact', () => {
  assertPayloadConflict(reduceSameNativeId([{ ...complete, new_string: 'caf\u00e9' }, { ...complete, new_string: 'cafe\u0301' }]));
  assertReducedOnce(reduceSameNativeId([{ name: 'caf\u00e9' }, { name: 'cafe\u0301' }], 'skill_view'));
});

// --- re-review of e002f26: outcome must not depend on how the partner spells the alias ---

test('R3 re-review 3: self-disagreeing aliases conflict whatever alias the partner uses', () => {
  for (const partner of [{ path: '/x' }, { file_path: '/x' }]) {
    assertPayloadConflict(reduceSameNativeId([{ path: '/x', file_path: '/y' }, partner], 'read_file'));
  }
  for (const partner of [{ path: '/p', old_string: 'a' }, { path: '/p', old_text: 'a' }, { path: '/p', oldText: 'a' }]) {
    assertPayloadConflict(reduceSameNativeId([{ path: '/p', old_string: 'a', old_text: 'b', new_string: 'n' }, partner]));
  }
  for (const partner of [{ name: 'a' }, { skill: 'a' }, { skill_name: 'a' }]) {
    assertPayloadConflict(reduceSameNativeId([{ name: 'a', skill: 'b' }, partner], 'skill_view'));
  }
  assertPayloadConflict(reduceSameNativeId([{ path: '/p', content: 'x', data: 'y' }, { path: '/p', content: 'x' }], 'write_file'));
});

test('R3 re-review 3: a truncated alias does not hide a disagreement between full values', () => {
  for (const partner of [{ path: '/p', old_string: 'abcxyz' }, { path: '/p', oldText: 'abcxyz' }]) {
    assertPayloadConflict(reduceSameNativeId([{ path: '/p', old_string: 'ab...[truncated]', old_text: 'abcdef' }, partner]));
  }
});

test('R3 re-review 3 control: consistent aliases and truncated aliases still reduce', () => {
  assertReducedOnce(reduceSameNativeId([{ path: '/p', old_text: 'a' }, { path: '/p', old_string: 'a' }]));
  assertReducedOnce(reduceSameNativeId([{ path: '/p', file_path: '/p' }, { path: '/p' }], 'read_file'));
  assertReducedOnce(reduceSameNativeId([{ path: '/p', old_string: 'ab...[truncated]', old_text: 'abcdef' }, { path: '/p', oldText: 'abcdef' }]));
  assertReducedOnce(reduceSameNativeId([{ path: '/p', content: 'x', data: 'x' }, { path: '/p', data: 'x' }], 'write_file'));
});

test('R3 re-review 3: duplicates of a self-contradictory representation fail closed', () => {
  const ambiguous = { path: '/p', old_string: 'a', old_text: 'b', new_string: 'n' };
  assertPayloadConflict(reduceSameNativeId([ambiguous, { ...ambiguous }]));
});
