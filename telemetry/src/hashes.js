import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalize } from './canonical-json.js';

export const ARTIFACT_SCOPE_PRIMARY_SKILL_MD = 'primary_skill_md_exact_bytes_v0';
export const NORMALIZER_VERSION = 'sg-skill-md-norm-v1';

function prefixed(algorithm, bytes) {
  return `${algorithm}:${createHash(algorithm).update(bytes).digest('hex')}`;
}

export function sha256Bytes(bytes) {
  if (!(typeof bytes === 'string' || Buffer.isBuffer(bytes) || ArrayBuffer.isView(bytes))) {
    throw new TypeError('sha256Bytes expects a string, Buffer, or typed array');
  }
  return prefixed('sha256', bytes);
}

export function sha256Canonical(value) {
  return sha256Bytes(canonicalize(value));
}

export function requireHmacKey(key) {
  const bytes = Buffer.isBuffer(key) ? key : Buffer.from(String(key ?? ''), 'utf8');
  if (bytes.byteLength < 32) {
    throw new Error('Telemetry HMAC key must contain at least 32 bytes');
  }
  return bytes;
}

export function hmacSha256(value, key) {
  const digest = createHmac('sha256', requireHmacKey(key))
    .update(typeof value === 'string' ? value : canonicalize(value))
    .digest('hex');
  return `hmac-sha256:${digest}`;
}

export function hashesEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function normalizeSkillMarkdownV1(input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);
  const withoutBom = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const lines = withoutBom.normalize('NFC').replace(/\r\n?/g, '\n').split('\n');
  const normalized = lines.map((line) => {
    const trimmed = line.replace(/[\t ]+$/g, '');
    return trimmed.replace(
      /^(\s*\*?Generated from SkillGraph on )\d{4}-\d{2}-\d{2}(\. Do not edit(?:[^\r\n]*)\*?\s*)$/,
      '$1<generated-date>$2',
    );
  });

  while (normalized.length > 0 && normalized.at(-1) === '') normalized.pop();
  return `${normalized.join('\n')}\n`;
}

export function hashSkillArtifact(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    throw new TypeError('hashSkillArtifact requires exact bytes as a Buffer');
  }
  return {
    artifact_scope: ARTIFACT_SCOPE_PRIMARY_SKILL_MD,
    artifact_sha256: sha256Bytes(bytes),
    hash_provenance: 'computed_exact_bytes_v0',
    normalized_content_hash: sha256Bytes(normalizeSkillMarkdownV1(bytes)),
    normalizer_version: NORMALIZER_VERSION,
  };
}
