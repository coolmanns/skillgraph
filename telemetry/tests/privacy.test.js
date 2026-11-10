import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStoredEvent } from '../src/event.js';
import { PrivacyViolation } from '../src/privacy.js';
import { episodeStartedEvent } from './helpers.js';

test('raw prompts, tool arguments, results, and secret-like strings are rejected before write', () => {
  for (const payloadPatch of [
    { prompt: 'private task' },
    { arguments: { path: '/private/file' } },
    { tool_result: 'everything succeeded' },
    { note: 'Bearer abcdefghijklmnopqrstuvwxyz123456' },
    { note: 'api_key=super-secret-value' },
  ]) {
    const event = episodeStartedEvent();
    event.payload = { ...event.payload, ...payloadPatch };
    assert.throws(() => buildStoredEvent(event), PrivacyViolation);
  }
});

test('opaque hashes and bounded structured labels survive privacy validation', () => {
  assert.doesNotThrow(() => buildStoredEvent(episodeStartedEvent()));
});
