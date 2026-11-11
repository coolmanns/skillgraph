import test from 'node:test';
import assert from 'node:assert/strict';
import { compareMillis, historyTimestampMillis } from '../src/adapters/hermes-time.js';

// Preserve the existing unit rule: positive large numbers are milliseconds;
// negative numeric timestamps are seconds. Expected values below are milliseconds.
for (const [input, expected] of [
  ['8640000000000000', '8640000000000000'],
  ['+8640000000000000.0', '8640000000000000'],
  ['8640000000000000e0', '8640000000000000'],
  ['8.64e15', '8640000000000000'],
  ['8640000000000000.0e0', '8640000000000000'],
  ['86400000000000000e-1', '8640000000000000'],
  ['8640000000000000e-1', '864000000000000'],
  ['8639999999999999.9', '8639999999999999.9'],
  ['-8640000000000', '-8640000000000000'],
  ['-8640000000000.0000', '-8640000000000000'],
  ['-8.64e12', '-8640000000000000'],
  ['-86400000000000e-1', '-8640000000000000'],
  ['-8639999999999.9999', '-8639999999999999.9'],
]) test(`numeric Date domain accepts exact boundary or interior: ${input}`, () => {
  const actual = historyTimestampMillis(input);
  assert.notEqual(actual, null);
  assert.equal(compareMillis(actual, expected), 0);
});

for (const input of [
  '8640000000000001',
  '8640000000000000.1',
  '+8640000000000000.000000001',
  '8.6400000000000001e15',
  '86400000000000001e-1',
  '-8640000000000.001',
  '-8640000000000.0001',
  '-8640000000000.000000000001',
  '-8.6400000000000001e12',
  '-86400000000000001e-4',
]) test(`numeric Date domain rejects exact out-of-range value: ${input}`, () => {
  assert.equal(historyTimestampMillis(input), null);
});
