import { hmacSha256, sha256Bytes } from '../src/hashes.js';
import { deterministicId } from '../src/ids.js';

export const TEST_HMAC_KEY = 'test-only-skillgraph-telemetry-key-0001';
export const TEST_TIME = '2026-07-22T12:00:00.000Z';
export const TEST_EPISODE_ID = deterministicId('test-episode', 'episode-1');
export const TEST_SOURCE_INSTANCE_ID = deterministicId('test-source-instance', 'hermes-profile-1');

export function testHmac(value) {
  return hmacSha256(value, TEST_HMAC_KEY);
}

export function baseEvent(eventType, payload, overrides = {}) {
  const natural = overrides.naturalKey ?? `${eventType}:1`;
  return {
    event_type: eventType,
    occurred_at: TEST_TIME,
    source_runtime: 'hermes',
    runtime_version: '0.18.2',
    source_instance_id: TEST_SOURCE_INSTANCE_ID,
    adapter_id: 'test-adapter',
    adapter_version: '0.1.0',
    source_event_key: testHmac(natural),
    supersedes_event_id: null,
    trace_id: null,
    span_id: null,
    parent_span_id: null,
    episode_id: TEST_EPISODE_ID,
    capture_mode: 'historical',
    confidence: 1,
    pseudonym_key_version: 'test-hmac-v1',
    payload,
    ...overrides,
  };
}

export function unresolvedSkill(name = 'coding-agent') {
  return {
    observed_skill_key: `obs:v0:hermes:${'1'.repeat(16)}:${'2'.repeat(64)}`,
    skill_uid: null,
    revision_id: null,
    name_snapshot: name,
    source_channel: 'hermes-local',
    artifact_sha256: null,
    artifact_scope: null,
    hash_provenance: null,
    normalized_content_hash: null,
    normalizer_version: null,
    artifact_observed_at: null,
    identity_method: 'source_qualified_native_id',
    identity_confidence: 0.7,
    identity_review_ref: null,
  };
}

export function batchMetadata(overrides = {}) {
  return {
    schema_version: 'skillgraph.telemetry.v0',
    source_runtime: 'hermes',
    runtime_version: '0.18.2',
    source_instance_id: TEST_SOURCE_INSTANCE_ID,
    adapter_id: 'test-adapter',
    adapter_version: '0.1.0',
    capture_mode: 'historical',
    redaction_policy_version: 'skillgraph.redaction.v0',
    pseudonym_key_version: 'test-hmac-v1',
    ...overrides,
  };
}

export function episodeStartedEvent(overrides = {}) {
  return baseEvent('episode.started', {
    source_session_hmac: testHmac('session-1'),
    source_turn_hmac: testHmac('turn-1'),
    principal_hmac: null,
    profile_hmac: null,
    model: 'gpt-5.5',
    provider: 'openai',
    environment_fingerprint: sha256Bytes('test-environment'),
    task_class_hmac: testHmac('implementation'),
    authorized_view_fingerprint: null,
    boundary_method: 'user_message_boundary',
  }, overrides);
}
