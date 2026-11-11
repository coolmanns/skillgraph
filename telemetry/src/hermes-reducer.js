import { canonicalize } from './canonical-json.js';
import { hmacSha256 } from './hashes.js';
import {
  argumentRichness,
  classifyOperation,
  classifyResultVariant,
  containsKnownTruncation,
  extractSkillStableFields,
  operationStableFields,
  parseJsonObject,
} from './classifiers.js';

function groupKey(sessionId, toolCallId) {
  return `${sessionId}\u0000${toolCallId}`;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function isKnownTruncation(value) {
  return typeof value === 'string' && value.endsWith('...[truncated]');
}

function callIdentity(call) {
  const id = nonEmptyString(call?.id);
  const callId = nonEmptyString(call?.call_id);
  const responseItemId = nonEmptyString(call?.response_item_id);
  const candidates = [id, callId].filter(Boolean);
  return {
    value: id ?? callId ?? responseItemId,
    conflicted: new Set(candidates).size > 1,
  };
}

function callToolName(call) {
  return nonEmptyString(call?.function?.name) ?? nonEmptyString(call?.name);
}

function callArguments(call) {
  if (call?.function && Object.hasOwn(call.function, 'arguments')) return call.function.arguments;
  return call?.arguments;
}

function parseToolCallArray(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return [parsed];
    return null;
  } catch {
    return null;
  }
}

function normalizeTimeMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return normalizeTimeMillis(numeric);
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function createWarningCounter() {
  const counts = new Map();
  return {
    add(code, increment = 1) {
      counts.set(code, (counts.get(code) ?? 0) + increment);
    },
    list() {
      return [...counts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([code, count]) => ({ code, count }));
    },
  };
}

function toolCallSubjectHmac(group, hmacKey, sourceInstanceId) {
  return hmacSha256({
    namespace: 'hermes-tool-call-v0',
    sourceInstanceId,
    sessionId: group.sessionId,
    toolCallId: group.toolCallId,
  }, hmacKey);
}

function quarantineRecord(group, hmacKey, sourceInstanceId, code, conflictFields) {
  const representations = [...group.calls, ...group.results]
    .filter((item) => Number.isSafeInteger(item.rowId))
    .sort((left, right) => left.rowId - right.rowId);
  const first = representations[0] ?? null;
  return {
    record_key_hmac: hmacSha256({
      namespace: 'hermes-reduction-quarantine-v0',
      sourceInstanceId,
      sessionId: group.sessionId,
      toolCallId: group.toolCallId,
    }, hmacKey),
    subject_key_hmac: toolCallSubjectHmac(group, hmacKey, sourceInstanceId),
    code,
    representation_count: group.calls.length + group.results.length,
    conflict_fields: [...new Set(conflictFields)].sort(),
    transientSessionId: group.sessionId,
    transientEarliestRowId: first?.rowId ?? null,
    transientOccurrenceMs: first?.timestampMs ?? null,
  };
}

function stableSkillConflict(calls, hmacKey) {
  const names = new Set();
  const paths = new Set();
  for (const call of calls) {
    if (!call.args.valid) continue;
    const fields = extractSkillStableFields(call.args.value);
    if (fields.requestedName && !isKnownTruncation(fields.requestedName)) {
      names.add(fields.requestedName.normalize('NFC').trim());
    }
    if (fields.filePath && !isKnownTruncation(fields.filePath)) {
      paths.add(hmacSha256({ namespace: 'hermes-reference-path-v0', value: fields.filePath }, hmacKey));
    }
  }
  const conflicts = [];
  if (names.size > 1) conflicts.push('skill_request_name');
  if (paths.size > 1) conflicts.push('skill_reference_target');
  return conflicts;
}

function stableOperationConflict(calls, toolName, hmacKey) {
  const targets = new Set();
  const actions = new Set();
  const placeholder = hmacSha256({ namespace: 'hermes-stable-field-placeholder-v0' }, hmacKey);
  for (const call of calls) {
    if (!call.args.valid) continue;
    const classified = classifyOperation(toolName, call.args.value, {
      hmacKey,
      perCallHmac: placeholder,
    });
    if (classified.targetHmac && !isKnownTruncation(classified.transientTarget)) {
      targets.add(`${classified.targetClass}:${classified.targetHmac}`);
    }
    for (const field of ['action', 'operation', 'mode']) {
      const value = call.args.value[field];
      if (typeof value === 'string' && value.trim() !== '' && !isKnownTruncation(value)) {
        actions.add(hmacSha256({
          namespace: 'hermes-operation-action-v0',
          toolName,
          value: value.normalize('NFC').trim().toLowerCase(),
        }, hmacKey));
        break;
      }
    }
  }
  const conflicts = [];
  if (targets.size > 1) conflicts.push('operation_target');
  if (actions.size > 1) conflicts.push('operation_action');
  return conflicts;
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTruncatedString(value) {
  return typeof value === 'string' && containsKnownTruncation(value);
}

// Documented argument aliases, per tool. Each representation is mapped onto the canonical name
// before comparison, even when it is incomplete, so `old_text` on one side meets `old_string` on
// the other. A representation whose own aliases disagree keeps them unmapped.
const ARGUMENT_ALIASES = {
  patch: { path: ['path', 'file_path'], old_string: ['old_string', 'old_text', 'oldText'],
    new_string: ['new_string', 'new_text', 'newText'], patch: ['patch', 'diff'] },
  read_file: { path: ['path', 'file_path'] },
  write_file: { path: ['path', 'file_path'], content: ['content', 'data'] },
  skill_view: { name: ['name', 'skill_name', 'skill'], file_path: ['file_path', 'path'] },
  skill_manage: { name: ['name', 'skill_name', 'skill'], file_path: ['file_path', 'path'] },
};
// Fields the older target/action/skill checks already compare after normalization
// (NFC + trim, lowercased for actions); payload comparison must not be stricter than they are.
const TRIMMED_FIELDS = new Set(['name']);
const ACTION_FIELDS = new Set(['action', 'operation', 'mode']);

function comparableRepresentation(toolName, args) {
  const out = { ...args };
  for (const [canonical, names] of Object.entries(ARGUMENT_ALIASES[toolName] ?? {})) {
    const present = names.filter((name) => Object.hasOwn(args, name) && args[name] !== undefined);
    if (present.length === 0) continue;
    const values = present.map((name) => canonicalize(args[name]));
    if (values.some((value) => value !== values[0])) continue;
    for (const name of present) delete out[name];
    out[canonical] = args[present[0]];
  }
  for (const [key, value] of Object.entries(out)) {
    if (typeof value !== 'string' || isTruncatedString(value)) continue;
    if (ACTION_FIELDS.has(key)) out[key] = value.normalize('NFC').trim().toLowerCase();
    else if (TRIMMED_FIELDS.has(key) && toolName.startsWith('skill_')) out[key] = value.normalize('NFC').trim();
  }
  return out;
}

// True when two representations of the same value genuinely disagree. A key present on only one
// side is a compaction omission and a string carrying the known truncation marker is a compaction
// variant; neither counts. Arrays are compared element by element: a truncated element exempts only
// itself, and any length difference is a conflict (the marker proves a string was cut, not that an
// array lost elements). Strings compare in NFC; everything else canonically (key order irrelevant).
function payloadsDisagree(left, right) {
  if (isPlainRecord(left) && isPlainRecord(right)) {
    return Object.keys(left).some((key) => Object.hasOwn(right, key)
      && left[key] !== undefined
      && right[key] !== undefined
      && payloadsDisagree(left[key], right[key]));
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return true;
    return left.some((item, index) => payloadsDisagree(item, right[index]));
  }
  if (isTruncatedString(left) || isTruncatedString(right)) return false;
  if (typeof left === 'string' && typeof right === 'string') {
    return left.normalize('NFC') !== right.normalize('NFC');
  }
  return canonicalize(left) !== canonicalize(right);
}

// R3: representations sharing one native call ID must agree on every shared field, both as
// retained (aliases mapped, see comparableRepresentation) and, for complete representations, after
// the classifier's default normalization (so an implicit replace_all=false contradicts an explicit
// true). Otherwise the identity is quarantined instead of silently choosing one.
function stablePayloadConflict(calls, toolName) {
  const items = calls
    .filter((call) => call.args.valid && isPlainRecord(call.args.value))
    .map((call) => {
      const stable = operationStableFields(toolName, call.args.value);
      return {
        raw: comparableRepresentation(toolName, call.args.value),
        stable: stable && comparableRepresentation(toolName, stable),
      };
    });
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const left = items[i];
      const right = items[j];
      if (payloadsDisagree(left.raw, right.raw)
        || (left.stable && right.stable && payloadsDisagree(left.stable, right.stable))) {
        return ['operation_payload'];
      }
    }
  }
  return [];
}

function chooseRichestCall(group, toolName) {
  return [...group.calls].sort((left, right) => {
    const scoreDifference = argumentRichness(right.args.value, { toolName })
      - argumentRichness(left.args.value, { toolName });
    if (scoreDifference !== 0) return scoreDifference;
    if (left.rowId !== right.rowId) return left.rowId - right.rowId;
    return left.callIndex - right.callIndex;
  })[0];
}

function chooseStrongestResult(group, toolName, readOnlyOverride) {
  const classified = group.results.map((result) => ({
    ...result,
    classification: classifyResultVariant(toolName, result.parsed.value, {
      explicitEffectDisposition: result.effectDisposition,
      readOnlyOverride,
    }),
  }));
  classified.sort((left, right) => {
    const strengthDifference = right.classification.strength - left.classification.strength;
    if (strengthDifference !== 0) return strengthDifference;
    const lengthDifference = Buffer.byteLength(right.rawContent ?? '', 'utf8')
      - Buffer.byteLength(left.rawContent ?? '', 'utf8');
    if (lengthDifference !== 0) return lengthDifference;
    return left.rowId - right.rowId;
  });
  return { selected: classified[0] ?? null, classified };
}

function resultConflicts(classified, hmacKey) {
  const decisiveStatuses = new Set(
    classified.filter((item) => item.classification.decisive).map((item) => item.classification.status),
  );
  const dispositions = new Set(
    classified
      .map((item) => item.classification.effectDisposition)
      .filter((value) => value !== 'unknown'),
  );
  const exitCodes = new Set(classified
    .map((item) => item.classification.exitCode)
    .filter((value) => value !== null));
  const stableRuntimeCodes = new Set();
  for (const item of classified) {
    const value = item.parsed?.value;
    if (!value || typeof value !== 'object') continue;
    for (const field of ['error_code', 'code', 'status_code']) {
      const code = value[field];
      if ((typeof code === 'string' && code.trim() !== '') || Number.isFinite(code)) {
        stableRuntimeCodes.add(hmacSha256({
          namespace: 'hermes-runtime-code-v0',
          field,
          value: code,
        }, hmacKey));
        break;
      }
    }
  }
  const conflicts = [];
  if (decisiveStatuses.size > 1) conflicts.push('attempt_status');
  if (dispositions.size > 1) conflicts.push('effect_disposition');
  if (exitCodes.size > 1) conflicts.push('terminal_exit_code');
  if (stableRuntimeCodes.size > 1) conflicts.push('runtime_error_code');
  return conflicts;
}

/**
 * Reduces all retained Hermes representations to one logical tool-call identity.
 * The returned `reduced` records contain transient raw source identifiers and
 * selected content for immediate in-process projection only. Callers must never
 * serialize them; extractHermesHistory converts them to privacy-safe events.
 */
export function reduceHermesToolRows({
  callRows,
  resultRows,
  sourceInstanceId,
  hmacKey,
}) {
  const groups = new Map();
  const warningCounter = createWarningCounter();
  let parsedCallItems = 0;

  const getGroup = (sessionId, toolCallId) => {
    const key = groupKey(sessionId, toolCallId);
    let group = groups.get(key);
    if (!group) {
      group = { sessionId, toolCallId, calls: [], results: [], flags: new Set() };
      groups.set(key, group);
    }
    return group;
  };

  for (const row of callRows) {
    const calls = parseToolCallArray(row.tool_calls);
    if (!calls) {
      warningCounter.add('malformed_tool_calls_json');
      continue;
    }
    for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
      const call = calls[callIndex];
      const identity = callIdentity(call);
      const toolCallId = identity.value;
      const toolName = callToolName(call);
      if (!toolCallId || !toolName) {
        warningCounter.add('tool_call_missing_identity');
        continue;
      }
      const sessionId = nonEmptyString(row.session_id);
      if (!sessionId || !Number.isSafeInteger(row.id)) {
        warningCounter.add('tool_call_invalid_source_row');
        continue;
      }
      const args = parseJsonObject(callArguments(call));
      const group = getGroup(sessionId, toolCallId);
      if (identity.conflicted) group.flags.add('call_identity_fields');
      group.calls.push({
        rowId: row.id,
        callIndex,
        timestampMs: normalizeTimeMillis(row.timestamp),
        toolName,
        args,
        active: row.active === 1,
        compacted: row.compacted === 1,
      });
      parsedCallItems += 1;
    }
  }

  for (const row of resultRows) {
    const sessionId = nonEmptyString(row.session_id);
    const toolCallId = nonEmptyString(row.tool_call_id);
    if (!sessionId || !toolCallId || !Number.isSafeInteger(row.id)) {
      warningCounter.add('tool_result_missing_identity');
      continue;
    }
    const rawContent = typeof row.content === 'string' ? row.content : '';
    const group = getGroup(sessionId, toolCallId);
    group.results.push({
      rowId: row.id,
      timestampMs: normalizeTimeMillis(row.timestamp),
      toolName: nonEmptyString(row.tool_name),
      rawContent,
      parsed: parseJsonObject(rawContent),
      effectDisposition: nonEmptyString(row.effect_disposition),
      active: row.active === 1,
      compacted: row.compacted === 1,
    });
  }

  const reduced = [];
  const quarantined = [];
  for (const group of groups.values()) {
    if (group.calls.length === 0) {
      quarantined.push(quarantineRecord(
        group,
        hmacKey,
        sourceInstanceId,
        'orphan_tool_result',
        ['tool_call_representation'],
      ));
      continue;
    }

    const toolNames = new Set([
      ...group.calls.map((item) => item.toolName),
      ...group.results.map((item) => item.toolName).filter(Boolean),
    ]);
    const conflicts = [...group.flags];
    if (toolNames.size !== 1) conflicts.push('tool_name');
    const toolName = group.calls[0].toolName;
    if (toolName === 'skill_view') conflicts.push(...stableSkillConflict(group.calls, hmacKey));
    else conflicts.push(...stableOperationConflict(group.calls, toolName, hmacKey));
    conflicts.push(...stablePayloadConflict(group.calls, toolName));

    const chosenCall = chooseRichestCall(group, toolName);
    const toolCallHmac = toolCallSubjectHmac(group, hmacKey, sourceInstanceId);
    const operation = classifyOperation(toolName, chosenCall.args.value, {
      hmacKey,
      perCallHmac: toolCallHmac,
    });
    const { selected: chosenResult, classified } = chooseStrongestResult(group, toolName, operation.readOnly);
    conflicts.push(...resultConflicts(classified, hmacKey));
    if (conflicts.length > 0) {
      quarantined.push(quarantineRecord(
        group,
        hmacKey,
        sourceInstanceId,
        'material_variant_conflict',
        conflicts,
      ));
      continue;
    }

    if (!chosenCall.args.valid) warningCounter.add('tool_arguments_unrecoverable');
    if (!chosenResult) warningCounter.add('tool_result_missing');
    else if (!chosenResult.classification.decisive) warningCounter.add('tool_result_status_unknown');

    const fallbackClassification = classifyResultVariant(toolName, null, {
      explicitEffectDisposition: null,
      readOnlyOverride: operation.readOnly,
    });

    reduced.push({
      transientSessionId: group.sessionId,
      transientToolCallId: group.toolCallId,
      transientArguments: chosenCall.args.value,
      transientResult: chosenResult?.parsed.value ?? null,
      transientResultContent: chosenResult?.rawContent ?? null,
      transientResultTimestampMs: chosenResult?.timestampMs ?? null,
      transientResultRowId: chosenResult?.rowId ?? null,
      earliestRowId: Math.min(...group.calls.map((item) => item.rowId)),
      earliestCallIndex: Math.min(...group.calls
        .filter((item) => item.rowId === Math.min(...group.calls.map((entry) => entry.rowId)))
        .map((item) => item.callIndex)),
      originalTimestampMs: [...group.calls]
        .sort((left, right) => left.rowId - right.rowId || left.callIndex - right.callIndex)[0]
        .timestampMs,
      representationCount: group.calls.length + group.results.length,
      timestampVariant: new Set(group.calls
        .map((item) => item.timestampMs)
        .filter((value) => value !== null)).size > 1,
      toolCallHmac,
      operation,
      result: chosenResult?.classification ?? fallbackClassification,
    });
  }

  reduced.sort((left, right) => left.earliestRowId - right.earliestRowId
    || left.earliestCallIndex - right.earliestCallIndex
    || left.toolCallHmac.localeCompare(right.toolCallHmac));
  quarantined.sort((left, right) => left.record_key_hmac.localeCompare(right.record_key_hmac));

  return {
    reduced,
    quarantined,
    warnings: warningCounter.list(),
    stats: {
      source_call_rows: callRows.length,
      source_result_rows: resultRows.length,
      parsed_call_representations: parsedCallItems,
      logical_tool_identities: groups.size,
      reduced_tool_identities: reduced.length,
      quarantined_tool_identities: quarantined.length,
      duplicate_representation_identities: [...groups.values()]
        .filter((group) => group.calls.length + group.results.length > 2).length,
    },
  };
}

export function safeReductionFingerprint(reducedRecord, hmacKey) {
  return hmacSha256({
    namespace: 'hermes-safe-reduction-fingerprint-v0',
    toolCallHmac: reducedRecord.toolCallHmac,
    operation: {
      toolName: reducedRecord.operation.toolName,
      normalizedOperation: reducedRecord.operation.normalizedOperation,
      targetHmac: reducedRecord.operation.targetHmac,
      operationSignature: reducedRecord.operation.operationSignature,
    },
    result: {
      status: reducedRecord.result.status,
      runtimeStatus: reducedRecord.result.runtimeStatus,
      runtimeErrorCode: reducedRecord.result.runtimeErrorCode,
      effectDisposition: reducedRecord.result.effectDisposition,
    },
  }, hmacKey);
}

export function canonicalArgumentFingerprint(args, hmacKey) {
  return args && typeof args === 'object'
    ? hmacSha256({ namespace: 'hermes-arguments-v0', canonical: canonicalize(args) }, hmacKey)
    : null;
}
