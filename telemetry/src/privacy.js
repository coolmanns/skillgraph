import { canonicalize } from './canonical-json.js';

const FORBIDDEN_KEY = /^(?:raw_.*|prompt|system_prompt|messages?|content|arguments?|args|tool_result|result_text|output|reasoning|reasoning_content|authorization|password|passwd|secret|api_?key|access_?token|refresh_?token|cookie|headers?)$/i;
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\b(?:sk|rk|pk)-(?:proj-)?[A-Za-z0-9_-]{12,}\b/,
  /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /(?:api[_-]?key|access[_-]?token|password)\s*[=:]\s*[^\s,;]{8,}/i,
];

export class PrivacyViolation extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = 'PrivacyViolation';
    this.code = code;
    this.path = path;
  }
}

function inspect(value, path, seen) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return;

  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > 8192) {
      throw new PrivacyViolation('string_too_large', path, `String exceeds privacy bound at ${path}`);
    }
    if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
      throw new PrivacyViolation('secret_pattern', path, `Secret-like material rejected at ${path}`);
    }
    return;
  }

  if (typeof value !== 'object') {
    throw new PrivacyViolation('non_json_value', path, `Non-JSON value rejected at ${path}`);
  }
  if (seen.has(value)) {
    throw new PrivacyViolation('circular_value', path, `Circular value rejected at ${path}`);
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      inspect(value[index], `${path}[${index}]`, seen);
    }
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) {
        throw new PrivacyViolation('forbidden_field', `${path}.${key}`, `Raw or sensitive field rejected at ${path}.${key}`);
      }
      inspect(item, `${path}.${key}`, seen);
    }
  }

  seen.delete(value);
}

export function enforcePrivacy(value, { maxPayloadBytes = 32 * 1024 } = {}) {
  inspect(value, '$', new Set());
  const bytes = Buffer.byteLength(canonicalize(value), 'utf8');
  if (bytes > maxPayloadBytes) {
    throw new PrivacyViolation('payload_too_large', '$', `Canonical event exceeds ${maxPayloadBytes} bytes`);
  }
  return value;
}
