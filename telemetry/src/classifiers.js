import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalize } from './canonical-json.js';
import { hmacSha256, sha256Bytes } from './hashes.js';

export const HERMES_CLASSIFIER_VERSION = 'hermes-tool-classifiers-v0';
export const HERMES_CLASSIFIER_ID = 'hermes-tool-status-classifier';
// Exact module bytes cover every rule table and branch below. A semantic
// version names the contract; this build hash makes an emitted assessment
// reproducible when implementation details change without a version bump.
export const HERMES_CLASSIFIER_HASH = sha256Bytes(
  fs.readFileSync(fileURLToPath(import.meta.url)),
);

const EFFECT_DISPOSITIONS = new Set(['none', 'applied', 'not_applied', 'partial', 'unknown']);
const READ_ONLY_TOOLS = new Set([
  'browser_console',
  'browser_snapshot',
  'browser_vision',
  'honcho_context',
  'honcho_profile',
  'honcho_reasoning',
  'honcho_search',
  'read_file',
  'search_files',
  'session_search',
  'skills_list',
  'vision_analyze',
]);

const KNOWN_SUCCESS_MARKERS = new Map([
  ['browser_console', ['entries', 'logs']],
  ['browser_navigate', ['url', 'title']],
  ['browser_snapshot', ['snapshot', 'nodes']],
  ['delegate_task', ['session_id', 'task_id']],
  ['read_file', ['content', 'file_size', 'resolved_path']],
  ['search_files', ['files', 'matches_text', 'total_count']],
  ['skill_manage', ['files_modified', 'skill_dir']],
  ['skill_view', ['content', 'name', 'skill_dir', 'readiness_status']],
  ['skills_list', ['skills', 'total_count']],
  ['write_file', ['files_modified', 'path']],
]);

const STATUS_MAP = new Map([
  ['ok', 'succeeded'],
  ['success', 'succeeded'],
  ['succeeded', 'succeeded'],
  ['complete', 'succeeded'],
  ['completed', 'succeeded'],
  ['error', 'failed'],
  ['fail', 'failed'],
  ['failed', 'failed'],
  ['timeout', 'timeout'],
  ['timed_out', 'timeout'],
  ['timed-out', 'timeout'],
  ['cancelled', 'cancelled'],
  ['canceled', 'cancelled'],
  ['blocked', 'blocked'],
  ['denied', 'blocked'],
]);

const COARSE_SIGNATURE_TOOLS = new Set([
  'terminal', 'execute_code', 'read_file', 'search_files', 'write_file', 'patch',
  'skill_view', 'skill_manage', 'browser_navigate',
]);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function countLeaves(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return 1;
  if (seen.has(value)) return 0;
  seen.add(value);
  const children = Array.isArray(value) ? value : Object.values(value);
  const result = children.reduce((total, child) => total + countLeaves(child, seen), 0);
  seen.delete(value);
  return result;
}

function containsKnownTruncation(value, seen = new Set()) {
  if (typeof value === 'string') return value.endsWith('...[truncated]');
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const children = Array.isArray(value) ? value : Object.values(value);
  const found = children.some((child) => containsKnownTruncation(child, seen));
  seen.delete(value);
  return found;
}

function normalizedStatus(value) {
  if (typeof value !== 'string') return null;
  return STATUS_MAP.get(value.trim().toLowerCase()) ?? null;
}

function explicitMiddlewareStatus(result) {
  if (!isPlainObject(result)) return null;
  if (result.blocked === true || result.denied === true) {
    return { status: 'blocked', runtimeStatus: 'middleware_blocked', runtimeErrorCode: 'policy_or_approval_block' };
  }
  if (result.cancelled === true || result.canceled === true) {
    return { status: 'cancelled', runtimeStatus: 'middleware_cancelled', runtimeErrorCode: 'cancelled' };
  }
  if (result.timeout === true || result.timed_out === true) {
    return { status: 'timeout', runtimeStatus: 'middleware_timeout', runtimeErrorCode: 'timeout' };
  }
  return null;
}

function explicitStructuredExceptionalStatus(result) {
  if (!isPlainObject(result)) return null;
  for (const field of ['status', 'completion_reason', 'termination_source']) {
    const status = normalizedStatus(result[field]);
    if (!['timeout', 'cancelled', 'blocked'].includes(status)) continue;
    return {
      status,
      runtimeStatus: `structured_${field}_${status}`,
      runtimeErrorCode: `structured_${status}`,
    };
  }
  return null;
}

function effectDisposition(toolName, explicit, readOnlyOverride) {
  if (typeof explicit === 'string' && EFFECT_DISPOSITIONS.has(explicit)) return explicit;
  if (typeof readOnlyOverride === 'boolean') return readOnlyOverride ? 'none' : 'unknown';
  return READ_ONLY_TOOLS.has(toolName) ? 'none' : 'unknown';
}

export function parseJsonObject(value) {
  if (isPlainObject(value)) return { valid: true, value, canonical: canonicalize(value) };
  if (typeof value !== 'string' || value.trim() === '') return { valid: false, value: null, canonical: null };
  try {
    let parsed = JSON.parse(value);
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    if (!isPlainObject(parsed)) return { valid: false, value: null, canonical: null };
    return { valid: true, value: parsed, canonical: canonicalize(parsed) };
  } catch {
    return { valid: false, value: null, canonical: null };
  }
}

export function classifyResultVariant(toolName, parsedResult, {
  explicitEffectDisposition = null,
  readOnlyOverride = null,
} = {}) {
  const disposition = effectDisposition(toolName, explicitEffectDisposition, readOnlyOverride);
  const structured = isPlainObject(parsedResult);
  const richness = structured ? Math.min(20, countLeaves(parsedResult)) : 0;
  const middleware = explicitMiddlewareStatus(parsedResult);
  if (middleware) {
    return {
      ...middleware,
      effectDisposition: disposition,
      exitCode: null,
      decisive: true,
      structured,
      strength: 180 + richness,
    };
  }

  if (structured && (toolName === 'terminal' || toolName === 'execute_code' || toolName === 'process')) {
    const exitCode = Number.isInteger(parsedResult.exit_code) ? parsedResult.exit_code : null;
    const exceptional = explicitStructuredExceptionalStatus(parsedResult);
    if (exceptional) {
      return {
        ...exceptional,
        effectDisposition: disposition,
        exitCode,
        decisive: true,
        structured: true,
        strength: 170 + richness,
      };
    }
    if (exitCode !== null) {
      const runtimeFamily = toolName === 'process' ? 'process' : 'terminal';
      return {
        status: exitCode === 0 ? 'succeeded' : 'failed',
        runtimeStatus: exitCode === 0 ? `${runtimeFamily}_exit_zero` : `${runtimeFamily}_exit_nonzero`,
        runtimeErrorCode: exitCode === 0 ? null : `${runtimeFamily}_exit_nonzero`,
        effectDisposition: disposition,
        exitCode,
        decisive: true,
        structured: true,
        strength: 160 + richness,
      };
    }
  }

  if (structured) {
    const mapped = normalizedStatus(parsedResult.status);
    if (mapped) {
      return {
        status: mapped,
        runtimeStatus: `structured_status_${mapped}`,
        runtimeErrorCode: ['failed', 'timeout', 'cancelled', 'blocked'].includes(mapped)
          ? `structured_${mapped}`
          : null,
        effectDisposition: disposition,
        exitCode: Number.isInteger(parsedResult.exit_code) ? parsedResult.exit_code : null,
        decisive: true,
        structured: true,
        strength: 120 + richness,
      };
    }

    if (typeof parsedResult.success === 'boolean') {
      return {
        status: parsedResult.success ? 'succeeded' : 'failed',
        runtimeStatus: parsedResult.success ? 'structured_success_true' : 'structured_success_false',
        runtimeErrorCode: parsedResult.success ? null : 'structured_success_false',
        effectDisposition: disposition,
        exitCode: Number.isInteger(parsedResult.exit_code) ? parsedResult.exit_code : null,
        decisive: true,
        structured: true,
        strength: 115 + richness,
      };
    }

    if (Object.hasOwn(parsedResult, 'error') && parsedResult.error !== null && parsedResult.error !== false && parsedResult.error !== '') {
      return {
        status: 'failed',
        runtimeStatus: 'structured_error',
        runtimeErrorCode: 'structured_error',
        effectDisposition: disposition,
        exitCode: Number.isInteger(parsedResult.exit_code) ? parsedResult.exit_code : null,
        decisive: true,
        structured: true,
        strength: 110 + richness,
      };
    }

    const markers = KNOWN_SUCCESS_MARKERS.get(toolName) ?? [];
    if (markers.some((field) => Object.hasOwn(parsedResult, field))) {
      return {
        status: 'succeeded',
        runtimeStatus: 'known_structured_result',
        runtimeErrorCode: null,
        effectDisposition: disposition,
        exitCode: Number.isInteger(parsedResult.exit_code) ? parsedResult.exit_code : null,
        decisive: true,
        structured: true,
        strength: 140 + richness,
      };
    }
  }

  return {
    status: 'unknown',
    runtimeStatus: structured ? 'structured_unknown' : 'compacted_or_unstructured_unknown',
    runtimeErrorCode: null,
    effectDisposition: disposition,
    exitCode: structured && Number.isInteger(parsedResult.exit_code) ? parsedResult.exit_code : null,
    decisive: false,
    structured,
    strength: structured ? 30 + richness : 5,
  };
}

function firstString(object, fields) {
  if (!isPlainObject(object)) return null;
  for (const field of fields) {
    if (typeof object[field] === 'string' && object[field].trim() !== '') return object[field];
  }
  return null;
}

function safeToolName(toolName) {
  const normalized = String(toolName ?? '').normalize('NFC').trim().toLowerCase()
    .replace(/[^a-z0-9._:/@+-]+/g, '_')
    .replace(/^[_:./@+-]+/, '')
    .slice(0, 128);
  return normalized || 'unknown_tool';
}

function operationName(toolName, args) {
  switch (toolName) {
    case 'terminal':
    case 'execute_code': return 'execute_command';
    case 'read_file': return 'read_resource';
    case 'search_files': return 'search_resources';
    case 'write_file': return 'write_resource';
    case 'patch': return 'patch_resource';
    case 'skill_view': return firstString(args, ['file_path', 'path']) ? 'load_skill_reference' : 'load_skill';
    case 'skill_manage': return 'manage_skill';
    case 'browser_navigate': return 'navigate_browser';
    case 'browser_click': return 'browser_click';
    case 'browser_type': return 'browser_type';
    case 'browser_press': return 'browser_press';
    case 'delegate_task': return 'delegate_task';
    default: return 'invoke_tool';
  }
}

function targetDescriptor(toolName, args) {
  if (!isPlainObject(args)) return { targetClass: null, target: null };
  switch (toolName) {
    case 'terminal':
    case 'execute_code': return { targetClass: 'command', target: firstString(args, ['command', 'code']) };
    case 'read_file':
    case 'write_file':
    case 'patch': return { targetClass: 'resource', target: firstString(args, ['path', 'file_path']) };
    case 'search_files': return {
      targetClass: 'search_scope',
      target: firstString(args, ['path', 'root', 'directory']) ?? firstString(args, ['query', 'pattern']),
    };
    case 'skill_view': {
      const reference = firstString(args, ['file_path', 'path']);
      return reference
        ? { targetClass: 'skill_reference', target: reference }
        : { targetClass: 'skill', target: firstString(args, ['name', 'skill_name', 'skill']) };
    }
    case 'skill_manage': return { targetClass: 'skill', target: firstString(args, ['name', 'skill_name', 'skill']) };
    case 'browser_navigate': return { targetClass: 'url', target: firstString(args, ['url']) };
    default: return { targetClass: null, target: null };
  }
}

function selectedFields(args, fields) {
  const selected = {};
  for (const field of fields) {
    if (Object.hasOwn(args, field) && args[field] !== undefined) selected[field] = args[field];
  }
  return Object.keys(selected).length > 0 ? selected : null;
}

function patchStableFields(args) {
  const allowed = ['path', 'file_path', 'mode', 'replace_all', 'patch', 'diff',
    'old_string', 'new_string', 'old_text', 'new_text', 'oldText', 'newText'];
  if (Object.keys(args).some(key => !allowed.includes(key)) || containsKnownTruncation(args)) return null;
  // Canonicalize only documented/legacy aliases with identical literal values.
  const alias = fields => {
    const values = fields.filter(field => Object.hasOwn(args, field)).map(field => args[field]);
    return values.length && values.every(value => typeof value === 'string' && value === values[0]) ? values[0] : null;
  };
  const path = alias(['path', 'file_path']);
  if (['path', 'file_path'].some(field => Object.hasOwn(args, field)) && !path?.trim()) return null;
  const hasPatch = ['patch', 'diff'].some(field => Object.hasOwn(args, field));
  const mode = Object.hasOwn(args, 'mode') ? args.mode : (hasPatch ? 'patch' : 'replace');
  if (mode === 'patch') {
    const patch = alias(['patch', 'diff']);
    if (!patch?.trim() || Object.keys(args).some(key => !['path', 'file_path', 'mode', 'patch', 'diff'].includes(key))) return null;
    return { mode, path, patch };
  }
  if (mode !== 'replace' || hasPatch || !path?.trim()) return null;
  const oldString = alias(['old_string', 'old_text', 'oldText']);
  const newString = alias(['new_string', 'new_text', 'newText']);
  if (!oldString || newString === null || (Object.hasOwn(args, 'replace_all') && typeof args.replace_all !== 'boolean')) return null;
  return { mode, path, old_string: oldString, new_string: newString, replace_all: args.replace_all ?? false };
}

function episodeStableFields(toolName, args) {
  if (!isPlainObject(args)) return null;
  switch (toolName) {
    case 'terminal':
    case 'execute_code':
      return selectedFields(args, ['command', 'code']);
    case 'read_file':
      return selectedFields(args, ['path', 'file_path', 'offset', 'line', 'start_line', 'end_line']);
    case 'search_files':
      return selectedFields(args, [
        'query', 'pattern', 'path', 'root', 'directory', 'glob', 'include', 'exclude',
      ]);
    case 'write_file':
      return selectedFields(args, ['path', 'file_path', 'content', 'data', 'mode']);
    case 'patch':
      return patchStableFields(args);
    case 'skill_view':
      return selectedFields(args, ['name', 'skill_name', 'skill', 'file_path', 'path']);
    case 'skill_manage':
      return selectedFields(args, [
        'action', 'operation', 'mode', 'name', 'skill_name', 'skill', 'file_path', 'path',
        'content', 'old_content', 'new_content',
      ]);
    case 'browser_navigate':
      return selectedFields(args, ['url']);
    default:
      return null;
  }
}

export function isOperationReadOnly(toolName, args) {
  if (toolName === 'memory') {
    const action = firstString(args, ['action', 'operation', 'mode'])?.trim().toLowerCase();
    return ['get', 'list', 'read', 'search', 'status'].includes(action);
  }
  return READ_ONLY_TOOLS.has(toolName);
}

export function classifyOperation(toolNameInput, args, { hmacKey, perCallHmac }) {
  const toolName = safeToolName(toolNameInput);
  const argsAreStructured = isPlainObject(args);
  const normalizedOperation = operationName(toolName, args);
  const { targetClass, target } = targetDescriptor(toolName, args);
  const targetHmac = target === null
    ? null
    : hmacSha256({ namespace: 'hermes-operation-target-v0', toolName, target }, hmacKey);
  const stableFields = episodeStableFields(toolName, args);
  const episodeOperationSignature = stableFields === null
    ? null
    : hmacSha256({
      namespace: 'hermes-episode-operation-stable-fields-v1',
      toolName,
      normalizedOperation,
      stableFields,
    }, hmacKey);
  const signatureEligible = argsAreStructured && targetHmac !== null && COARSE_SIGNATURE_TOOLS.has(toolName);
  const operationSignature = signatureEligible
    ? hmacSha256({
      namespace: 'hermes-allowlisted-operation-signature-v1',
      toolName,
      normalizedOperation,
      targetClass,
      targetHmac,
    }, hmacKey)
    : null;

  return {
    toolName,
    normalizedOperation,
    targetClass,
    targetHmac,
    operationSignature,
    episodeOperationSignature,
    groupable: episodeOperationSignature !== null,
    readOnly: isOperationReadOnly(toolName, args),
    derivationMethod: episodeOperationSignature !== null
      ? 'hermes_allowlisted_stable_fields_v1'
      : 'hermes_operation_signature_unknown_v1',
    skillRequest: toolName === 'skill_view' ? {
      requestedName: firstString(args, ['name', 'skill_name', 'skill']),
      filePath: firstString(args, ['file_path', 'path']),
    } : null,
    transientTarget: target,
  };
}

export function argumentRichness(args, { toolName = null } = {}) {
  if (!isPlainObject(args)) return -1;
  let score = countLeaves(args) * 10 + Math.min(999, Buffer.byteLength(canonicalize(args), 'utf8'));
  if (containsKnownTruncation(args)) score -= 1_000_000;
  if (toolName === 'skill_view') {
    if (firstString(args, ['name', 'skill_name', 'skill'])) score += 10_000;
    if (firstString(args, ['file_path', 'path'])) score += 100_000;
  }
  return score;
}

export function extractSkillStableFields(args) {
  return {
    requestedName: firstString(args, ['name', 'skill_name', 'skill']),
    filePath: firstString(args, ['file_path', 'path']),
  };
}

export function classifyAttemptError(resultClassification) {
  const { status, runtimeErrorCode } = resultClassification;
  if (!['failed', 'timeout', 'blocked'].includes(status)) return null;

  let errorClass = 'unknown';
  let responsibilityClass = 'unknown';
  let confidence = 0.35;
  if (status === 'blocked' || runtimeErrorCode === 'policy_or_approval_block') {
    errorClass = 'policy_or_approval_block';
    responsibilityClass = 'policy_denied_action';
    confidence = 0.9;
  } else if (status === 'timeout' || runtimeErrorCode === 'timeout') {
    errorClass = 'timeout';
    confidence = 0.8;
  }

  return {
    error_class: errorClass,
    responsibility_class: responsibilityClass,
    classifier_id: HERMES_CLASSIFIER_ID,
    classifier_version: HERMES_CLASSIFIER_VERSION,
    classifier_hash: HERMES_CLASSIFIER_HASH,
    classification_confidence: confidence,
    classification_method: 'tool_specific_status_only_v0',
  };
}
