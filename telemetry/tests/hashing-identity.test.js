import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalize, CanonicalJsonError } from '../src/canonical-json.js';
import {
  hashSkillArtifact,
  hmacSha256,
  normalizeSkillMarkdownV1,
  sha256Bytes,
} from '../src/hashes.js';
import { createObservedSkillKey } from '../src/identity.js';
import { TEST_HMAC_KEY } from './helpers.js';

test('canonical JSON is stable across object insertion order', () => {
  assert.equal(canonicalize({ z: 1, a: { y: 2, x: 3 } }), canonicalize({ a: { x: 3, y: 2 }, z: 1 }));
  assert.throws(() => canonicalize({ bad: Number.NaN }), CanonicalJsonError);
  assert.throws(() => canonicalize(new Array(2)), /Sparse arrays/);
});

test('exact artifact hash changes while documented generated-date normalization stays stable', () => {
  const a = Buffer.from('---\nname: demo\n---\nBody\n*Generated from SkillGraph on 2026-07-21. Do not edit — update the graph instead.*\n');
  const b = Buffer.from('---\r\nname: demo\r\n---\r\nBody\r\n*Generated from SkillGraph on 2026-07-22. Do not edit — update the graph instead.*\r\n');
  const hashA = hashSkillArtifact(a);
  const hashB = hashSkillArtifact(b);
  assert.notEqual(hashA.artifact_sha256, hashB.artifact_sha256);
  assert.equal(hashA.normalized_content_hash, hashB.normalized_content_hash);
  assert.equal(hashA.hash_provenance, 'computed_exact_bytes_v0');
  assert.equal(normalizeSkillMarkdownV1(a), normalizeSkillMarkdownV1(b));
  assert.throws(() => hashSkillArtifact(a.toString('utf8')), /requires exact bytes/);
  assert.throws(() => hashSkillArtifact(new Uint8Array(a)), /requires exact bytes/);
});

test('observed Skill identity is source-qualified and keyed', () => {
  const base = {
    source_runtime: 'hermes',
    source_instance_id: 'instance-a',
    source_channel: 'workspace',
    source_authority: 'local',
    source_package: 'skills',
    native_skill_id: 'coding-agent',
  };
  const first = createObservedSkillKey(base, TEST_HMAC_KEY);
  const again = createObservedSkillKey({ ...base }, TEST_HMAC_KEY);
  const otherInstance = createObservedSkillKey({ ...base, source_instance_id: 'instance-b' }, TEST_HMAC_KEY);
  assert.equal(first, again);
  assert.notEqual(first, otherInstance);
  assert.match(first, /^obs:v0:hermes:[0-9a-f]{16}:[0-9a-f]{64}$/);
  assert.notEqual(hmacSha256('common prompt', TEST_HMAC_KEY), sha256Bytes('common prompt'));
});
