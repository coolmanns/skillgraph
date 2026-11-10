import { createHash } from 'node:crypto';
import { canonicalize } from './canonical-json.js';
import { hmacSha256 } from './hashes.js';

const REQUIRED_IDENTITY_FIELDS = [
  'source_runtime',
  'source_instance_id',
  'source_channel',
  'source_authority',
  'source_package',
  'native_skill_id',
];

function safeRuntime(runtime) {
  return String(runtime).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

export function createObservedSkillKey(identity, hmacKey) {
  for (const field of REQUIRED_IDENTITY_FIELDS) {
    if (typeof identity?.[field] !== 'string' || identity[field].trim() === '') {
      throw new TypeError(`Observed Skill identity requires ${field}`);
    }
  }

  const normalized = Object.fromEntries(
    REQUIRED_IDENTITY_FIELDS.map((field) => [field, identity[field].normalize('NFC').trim()]),
  );
  const instanceTag = createHash('sha256')
    .update(normalized.source_instance_id)
    .digest('hex')
    .slice(0, 16);
  const digest = hmacSha256(canonicalize(normalized), hmacKey).slice('hmac-sha256:'.length);
  return `obs:v0:${safeRuntime(normalized.source_runtime)}:${instanceTag}:${digest}`;
}

export function unresolvedSkillIdentity({ identity, nameSnapshot, hmacKey, method = 'source_qualified_native_id' }) {
  return {
    observed_skill_key: createObservedSkillKey(identity, hmacKey),
    skill_uid: null,
    revision_id: null,
    name_snapshot: String(nameSnapshot).normalize('NFC').trim(),
    source_channel: identity.source_channel,
    artifact_sha256: null,
    artifact_scope: null,
    hash_provenance: null,
    normalized_content_hash: null,
    normalizer_version: null,
    artifact_observed_at: null,
    identity_method: method,
    identity_confidence: 0.7,
    identity_review_ref: null,
  };
}
