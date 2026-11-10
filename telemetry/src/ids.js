import { createHash, randomUUID } from 'node:crypto';
import { canonicalize } from './canonical-json.js';

const TELEMETRY_NAMESPACE = '7f95e53a-7646-5ef2-8baf-50f284312f6c';

function uuidToBytes(uuid) {
  const hex = uuid.replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new TypeError(`Invalid UUID namespace: ${uuid}`);
  return Buffer.from(hex, 'hex');
}

function bytesToUuid(bytes) {
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uuidV5(name, namespace = TELEMETRY_NAMESPACE) {
  const digest = createHash('sha1')
    .update(uuidToBytes(namespace))
    .update(String(name), 'utf8')
    .digest()
    .subarray(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  return bytesToUuid(digest);
}

export function deterministicId(kind, naturalKey) {
  return uuidV5(`${kind}:${canonicalize(naturalKey)}`);
}

export function newId() {
  return randomUUID();
}
