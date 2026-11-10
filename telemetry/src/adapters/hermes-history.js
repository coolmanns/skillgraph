import fs from 'node:fs';
import { readSelectedHistory } from './hermes-selection.js';
import path from 'node:path';
import Database from 'better-sqlite3';
import { canonicalize } from '../canonical-json.js';
import { REDACTION_POLICY_VERSION, SCHEMA_VERSION } from '../event.js';
import { sha256Bytes, hmacSha256, requireHmacKey } from '../hashes.js';
import { deterministicId } from '../ids.js';
import { unresolvedSkillIdentity } from '../identity.js';
import { reduceHermesToolRows } from '../hermes-reducer.js';
import { classifyAttemptError } from '../classifiers.js';

export const HERMES_HISTORY_ADAPTER_ID = 'hermes-history';
const ADAPTER_BUILD_FILES = [
  './hermes-history.js',
  './hermes-selection.js',
  '../hermes-reducer.js',
  '../classifiers.js',
  '../canonical-json.js',
  '../event.js',
  '../hashes.js',
  '../identity.js',
  '../ids.js',
];
export const HERMES_HISTORY_ADAPTER_BUILD_HASH = sha256Bytes(canonicalize(
  ADAPTER_BUILD_FILES.map((filename) => ({
    filename,
    sha256: sha256Bytes(fs.readFileSync(new URL(filename, import.meta.url))),
  })),
));
export const HERMES_HISTORY_ADAPTER_VERSION = `0.1.0+${HERMES_HISTORY_ADAPTER_BUILD_HASH.slice(7, 23)}`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+:/@-]{0,127}$/;
const EVENT_TYPES = [
  'episode.started',
  'episode.closed',
  'routing.decided',
  'skill.stage',
  'skill.plan.created',
  'tool.operation',
  'tool.attempt',
  'approval.decided',
  'constraint.evaluated',
  'evidence.observed',
  'outcome.assessed',
  'feedback.observed',
  'resource.observed',
  'experiment.assigned',
];

function openReadonlyDatabase(filename, label) {
  const resolved = path.resolve(String(filename ?? ''));
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error('not_file');
  } catch {
    throw new Error(`${label} is unavailable or is not a regular file`);
  }
  let db;
  try {
    db = new Database(resolved, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
    return db;
  } catch {
    db?.close();
    throw new Error(`${label} could not be opened read-only`);
  }
}

function tableColumns(db, table) {
  const row = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table);
  if (!row) return null;
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name));
}

function requireColumns(db, table, required) {
  const columns = tableColumns(db, table);
  if (!columns) throw new Error(`Hermes source is missing required table ${table}`);
  const missing = required.filter((column) => !columns.has(column));
  if (missing.length > 0) throw new Error(`Hermes source table ${table} is missing required columns`);
  return columns;
}

function toMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return toMillis(numeric);
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseBoundary(value, name) {
  if (value === null || value === undefined) return null;
  const parsed = toMillis(value);
  if (parsed === null) throw new TypeError(`${name} must be a valid date-time or epoch value`);
  return parsed;
}

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function fixedIdentifier(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.normalize('NFC').trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/.test(trimmed) ? trimmed : null;
}

const PUBLIC_PROVIDERS = new Set([
  'anthropic', 'deepseek', 'gemini', 'google', 'google-ai', 'groq', 'mistral',
  'ollama', 'openai', 'openrouter', 'xai',
]);
const PUBLIC_MODEL_PATTERNS = [
  /^gpt-[a-z0-9][a-z0-9._+-]{0,123}$/,
  /^o[1-9](?:-[a-z0-9][a-z0-9._+-]{0,123})?$/,
  /^claude-[a-z0-9][a-z0-9._+-]{0,120}$/,
  /^gemini-[a-z0-9][a-z0-9._+-]{0,120}$/,
  /^(?:llama|mistral|mixtral|qwen|deepseek|grok)-[a-z0-9][a-z0-9._+-]{0,118}$/,
];

function publicProviderId(value) {
  const identifier = fixedIdentifier(value)?.toLowerCase() ?? null;
  return identifier && PUBLIC_PROVIDERS.has(identifier) ? identifier : null;
}

function publicModelId(value) {
  const identifier = fixedIdentifier(value)?.toLowerCase() ?? null;
  return identifier && PUBLIC_MODEL_PATTERNS.some((pattern) => pattern.test(identifier)) ? identifier : null;
}

function safeLabel(value) {
  if (typeof value !== 'string') return null;
  const result = value.normalize('NFC').replace(/[\r\n\u0000-\u001f]/g, ' ').trim().slice(0, 256);
  return result || null;
}

function firstString(object, fields) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return null;
  for (const field of fields) {
    if (typeof object[field] === 'string' && object[field].trim() !== '') return object[field];
  }
  return null;
}

function sourceEventKey(hmacKey, naturalKey) {
  return hmacSha256({ namespace: 'hermes-history-source-event-v0', ...naturalKey }, hmacKey);
}

function sessionHmac(sourceInstanceId, sessionId, hmacKey) {
  return hmacSha256({ namespace: 'hermes-session-v0', sourceInstanceId, sessionId }, hmacKey);
}

function mergeWarnings(...warningLists) {
  const counts = new Map();
  for (const warnings of warningLists) {
    for (const warning of warnings) counts.set(warning.code, (counts.get(warning.code) ?? 0) + warning.count);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, count]) => ({ code, count }));
}

function warningCounter() {
  const counts = new Map();
  return {
    add(code, count = 1) {
      counts.set(code, (counts.get(code) ?? 0) + count);
    },
    list() {
      return [...counts.entries()].map(([code, count]) => ({ code, count }));
    },
  };
}

function capabilityCoverage(withVerification) {
  const coverage = Object.fromEntries(EVENT_TYPES.map((eventType) => [eventType, 'unsupported']));
  coverage['episode.started'] = 'inferred';
  coverage['skill.stage'] = 'historical';
  coverage['tool.operation'] = 'historical';
  coverage['tool.attempt'] = 'historical';
  coverage['evidence.observed'] = withVerification ? 'historical' : 'unsupported';
  return coverage;
}

function baseEventFactory({ sourceInstanceId, runtimeVersion, pseudonymKeyVersion }) {
  return ({ eventType, occurredAt, sourceKey, sourceSequence, episodeId, confidence, payload }) => ({
    event_type: eventType,
    occurred_at: occurredAt,
    source_sequence: sourceSequence,
    source_runtime: 'hermes',
    runtime_version: runtimeVersion,
    source_instance_id: sourceInstanceId,
    adapter_id: HERMES_HISTORY_ADAPTER_ID,
    adapter_version: HERMES_HISTORY_ADAPTER_VERSION,
    source_event_key: sourceKey,
    supersedes_event_id: null,
    trace_id: null,
    span_id: null,
    parent_span_id: null,
    episode_id: episodeId,
    capture_mode: 'historical',
    confidence,
    pseudonym_key_version: pseudonymKeyVersion,
    payload,
  });
}

function readStateSource(db, bounds = null, sinceMs = null, untilMs = null) {
  let sourceReadBounds = null;
  let messageSource = 'messages';
  let sessionSource = 'sessions';
  db.function('collector_ms', {deterministic:true}, toMillis);
  const timeWhere = [sinceMs === null ? '1' : `collector_ms(timestamp)>=${sinceMs}`,untilMs === null ? '1' : `collector_ms(timestamp)<${untilMs}`].join(' AND ');
  messageSource = `(SELECT * FROM messages WHERE ${timeWhere})`;
  if (bounds !== null) {
    const { sessionLimit, rowLimit, maxFieldBytes } = bounds;
    if (![sessionLimit, rowLimit, maxFieldBytes].every(Number.isSafeInteger)
      || sessionLimit < 1 || sessionLimit > 100 || rowLimit < 1 || rowLimit > 10000
      || maxFieldBytes < 1024 || maxFieldBytes > 1048576) throw new TypeError('invalid history bounds');
    // SQL bounds apply BEFORE materializing private text. No temporary tables/writes.
    const profileFilter = tableColumns(db, 'sessions')?.has('profile_name')
      ? "WHERE profile_name = 'default'" : '';
    sessionSource = `(SELECT * FROM sessions ${profileFilter} ORDER BY started_at DESC, id DESC LIMIT ${sessionLimit})`;
    messageSource = `(SELECT * FROM messages WHERE ${timeWhere} AND session_id IN (SELECT id FROM ${sessionSource}) ORDER BY id DESC LIMIT ${rowLimit})`;
    const counts = db.prepare(`SELECT COUNT(*) AS rowsRead FROM ${messageSource}`).get();
    const oversizedFields = db.prepare(`SELECT COALESCE(SUM(
      CASE WHEN length(CAST(content AS BLOB)) > ${maxFieldBytes} THEN 1 ELSE 0 END +
      CASE WHEN length(CAST(tool_calls AS BLOB)) > ${maxFieldBytes} THEN 1 ELSE 0 END),0) AS n
      FROM ${messageSource}`).get().n;
    sourceReadBounds = {sessionLimit,rowLimit,maxFieldBytes,
      sessionsRead:db.prepare(`SELECT COUNT(*) AS n FROM ${sessionSource}`).get().n,
      rowsRead:counts.rowsRead,oversizedFields,coverage:'bounded_tail_not_complete_history'};
  }
  const boundedField = (name) => bounds
    ? `CASE WHEN length(CAST(${name} AS BLOB)) <= ${bounds.maxFieldBytes} THEN ${name} ELSE NULL END AS ${name}` : name;
  const messageColumns = requireColumns(db, 'messages', [
    'id', 'session_id', 'role', 'tool_call_id', 'tool_calls', 'tool_name', 'content', 'timestamp',
  ]);
  const sessionColumns = requireColumns(db, 'sessions', ['id', 'started_at']);
  const effectExpression = messageColumns.has('effect_disposition') ? 'effect_disposition' : 'NULL AS effect_disposition';
  const activeExpression = messageColumns.has('active') ? 'active' : '1 AS active';
  const compactedExpression = messageColumns.has('compacted') ? 'compacted' : '0 AS compacted';
  const modelExpression = sessionColumns.has('model') ? 'model' : 'NULL AS model';
  const providerExpression = sessionColumns.has('billing_provider') ? 'billing_provider' : 'NULL AS billing_provider';
  const endedExpression = sessionColumns.has('ended_at') ? 'ended_at' : 'NULL AS ended_at';

  const callRows = db.prepare(`
    SELECT id, session_id, ${boundedField('tool_calls')}, timestamp, ${activeExpression}, ${compactedExpression}
    FROM ${messageSource}
    WHERE role = 'assistant' AND tool_calls IS NOT NULL
    ORDER BY id
  `).all();
  const resultRows = db.prepare(`
    SELECT id, session_id, tool_call_id, tool_name, ${boundedField('content')}, timestamp,
           ${effectExpression}, ${activeExpression}, ${compactedExpression}
    FROM ${messageSource}
    WHERE role = 'tool' AND tool_call_id IS NOT NULL
    ORDER BY id
  `).all();
  const userRows = db.prepare(`
    SELECT id, session_id, ${boundedField('content')}, timestamp, ${activeExpression}, ${compactedExpression}
    FROM ${messageSource}
    WHERE role = 'user'
    ORDER BY id
  `).all();
  const sessions = db.prepare(`
    SELECT id, started_at, ${endedExpression}, ${modelExpression}, ${providerExpression}
    FROM ${sessionSource}
  `).all();
  const schemaVersionColumns = tableColumns(db, 'schema_version');
  const declaredVersion = schemaVersionColumns?.has('version')
    ? db.prepare('SELECT MAX(version) AS version FROM schema_version').get()?.version
    : null;
  const pragmaVersion = db.pragma('user_version', { simple: true });
  const numericVersion = Number.isSafeInteger(declaredVersion) && declaredVersion >= 0
    ? declaredVersion
    : (Number.isSafeInteger(pragmaVersion) && pragmaVersion >= 0 ? pragmaVersion : 0);
  const sourceSchemaVersion = `hermes-state-${Math.min(numericVersion, 1_000_000)}`;
  return { callRows, resultRows, userRows, sessions, sourceSchemaVersion, sourceReadBounds };
}

function groupUsersBySession(userRows, sourceInstanceId, hmacKey, warnings) {
  const equivalenceGroups = new Map();
  for (const row of userRows) {
    const timestampMs = toMillis(row.timestamp);
    const contentHmac = hmacSha256({
      namespace: 'hermes-user-content-v0',
      sourceInstanceId,
      sessionId: row.session_id,
      content: typeof row.content === 'string' ? row.content : null,
    }, hmacKey);
    const equivalenceKey = timestampMs === null
      ? `missing:${row.id}`
      : hmacSha256({
        namespace: 'hermes-user-anchor-equivalence-v0',
        sourceInstanceId,
        sessionId: row.session_id,
        timestampMs,
        contentHmac,
      }, hmacKey);
    if (!equivalenceGroups.has(equivalenceKey)) equivalenceGroups.set(equivalenceKey, []);
    equivalenceGroups.get(equivalenceKey).push({ ...row, timestampMs, contentHmac });
  }

  const map = new Map();
  for (const variants of equivalenceGroups.values()) {
    variants.sort((left, right) => left.id - right.id);
    const first = variants[0];
    const hasCompactionEvidence = variants.some((variant) => Number(variant.compacted) === 1)
      || new Set(variants.map((variant) => Number(variant.active) === 1)).size > 1;
    let boundaryMethod = 'preceding_user_row_by_source_order_v0';
    let boundaryConfidence = 0.7;
    if (first.timestampMs === null) {
      boundaryMethod = 'user_anchor_missing_timestamp_v0';
      boundaryConfidence = 0.4;
      warnings.add('user_anchor_timestamp_missing');
    } else if (variants.length > 1 && hasCompactionEvidence) {
      boundaryMethod = 'reconciled_compaction_user_anchor_v0';
      boundaryConfidence = 0.6;
      warnings.add('user_anchor_variants_reconciled', variants.length - 1);
    } else if (variants.length > 1) {
      boundaryMethod = 'ambiguous_equal_timestamp_content_anchor_v0';
      boundaryConfidence = 0.4;
      warnings.add('user_anchor_ambiguous_duplicates', variants.length - 1);
    }
    const anchorHmac = hmacSha256({
      namespace: 'hermes-user-anchor-v1',
      sourceInstanceId,
      sessionId: first.session_id,
      timestampMs: first.timestampMs,
      contentHmac: first.contentHmac,
      missingTimestampRowId: first.timestampMs === null ? first.id : null,
    }, hmacKey);
    const canonical = {
      anchorHmac,
      timestamp: first.timestamp,
      timestampMs: first.timestampMs,
      boundaryMethod,
      boundaryConfidence,
    };
    if (!map.has(first.session_id)) map.set(first.session_id, []);
    for (const variant of variants) map.get(first.session_id).push({ id: variant.id, canonical });
  }
  for (const aliases of map.values()) aliases.sort((left, right) => left.id - right.id);
  return map;
}

function precedingUser(users, rowId) {
  if (!users || users.length === 0) return null;
  let low = 0;
  let high = users.length - 1;
  let result = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (users[middle].id < rowId) {
      result = users[middle].canonical;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function assignChronology(reduced, sessionMap, warnings) {
  const groups = new Map();
  for (const record of reduced) {
    if (!groups.has(record.transientSessionId)) groups.set(record.transientSessionId, []);
    groups.get(record.transientSessionId).push(record);
  }
  for (const [sessionId, records] of groups) {
    records.sort((left, right) => left.earliestRowId - right.earliestRowId
      || left.earliestCallIndex - right.earliestCallIndex
      || left.toolCallHmac.localeCompare(right.toolCallHmac));
    const sessionFallback = toMillis(sessionMap.get(sessionId)?.started_at) ?? 0;
    let maximumSeen = null;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const advisory = record.originalTimestampMs ?? sessionFallback;
      const missing = record.originalTimestampMs === null;
      const regressed = maximumSeen !== null && advisory < maximumSeen;
      if (missing) warnings.add('timestamp_missing_fallback');
      if (regressed) warnings.add('timestamp_source_order_regression');
      if (record.timestampVariant) warnings.add('timestamp_variant_observed');
      record.eventTimestampMs = advisory;
      record.timestampAmbiguous = missing || regressed || record.timestampVariant;
      record.sourceOrdinal = index + 1;
      maximumSeen = maximumSeen === null ? advisory : Math.max(maximumSeen, advisory);
    }
  }
}

function episodeIdentity(sessionId, rowId, usersBySession, sourceInstanceId, hmacKey) {
  const anchor = precedingUser(usersBySession.get(sessionId), rowId);
  const anchorHmac = anchor
    ? anchor.anchorHmac
    : hmacSha256({
      namespace: 'hermes-session-fallback-anchor-v0',
      sourceInstanceId,
      sessionId,
    }, hmacKey);
  return {
    anchor,
    anchorHmac,
    episodeId: deterministicId('hermes-episode', { sourceInstanceId, anchorHmac }),
  };
}

function buildEpisodes(records, usersBySession, sessionMap, sourceInstanceId, hmacKey, makeEvent) {
  const episodes = new Map();
  for (const record of records) {
    const { anchor, anchorHmac, episodeId } = episodeIdentity(
      record.transientSessionId,
      record.earliestRowId,
      usersBySession,
      sourceInstanceId,
      hmacKey,
    );
    record.episodeId = episodeId;
    record.episodeAnchorHmac = anchorHmac;
    if (!episodes.has(episodeId)) {
      episodes.set(episodeId, {
        episodeId,
        sessionId: record.transientSessionId,
        anchor,
        anchorHmac,
        firstTimestampMs: record.eventTimestampMs,
        firstOrdinal: record.sourceOrdinal,
      });
    } else {
      const episode = episodes.get(episodeId);
      episode.firstTimestampMs = Math.min(episode.firstTimestampMs, record.eventTimestampMs);
      episode.firstOrdinal = Math.min(episode.firstOrdinal, record.sourceOrdinal);
    }
  }

  for (const episode of episodes.values()) {
    const episodeRecords = records
      .filter((record) => record.episodeId === episode.episodeId)
      .sort((left, right) => left.earliestRowId - right.earliestRowId
        || left.earliestCallIndex - right.earliestCallIndex
        || left.toolCallHmac.localeCompare(right.toolCallHmac));
    const anchors = [];
    for (const record of episodeRecords) {
      anchors.push({
        record,
        kind: 'call',
        rowId: record.earliestRowId,
        callIndex: record.earliestCallIndex,
      });
      if (record.operation.toolName === 'skill_view' && Number.isSafeInteger(record.transientResultRowId)) {
        anchors.push({
          record,
          kind: 'skill_result',
          rowId: record.transientResultRowId,
          callIndex: Number.MAX_SAFE_INTEGER,
        });
      }
    }
    anchors.sort((left, right) => left.rowId - right.rowId
      || left.callIndex - right.callIndex
      || left.kind.localeCompare(right.kind)
      || left.record.toolCallHmac.localeCompare(right.record.toolCallHmac));
    for (let index = 0; index < anchors.length; index += 1) {
      const ordinal = index + 1;
      if (anchors[index].kind === 'call') anchors[index].record.episodeSourceOrdinal = ordinal;
      else anchors[index].record.skillResultSourceOrdinal = ordinal;
    }
    episode.maxSourceOrdinal = anchors.length;
  }

  const events = [];
  for (const episode of episodes.values()) {
    const session = sessionMap.get(episode.sessionId) ?? {};
    const anchorTimestampMs = episode.anchor?.timestampMs ?? null;
    const boundaryTimestampMs = anchorTimestampMs ?? episode.firstTimestampMs;
    const anchorTimeAmbiguous = anchorTimestampMs === null
      || (episode.anchor && anchorTimestampMs > episode.firstTimestampMs);
    const confidence = episode.anchor
      ? (anchorTimeAmbiguous
        ? Math.min(0.55, episode.anchor.boundaryConfidence)
        : episode.anchor.boundaryConfidence)
      : 0.35;
    events.push(makeEvent({
      eventType: 'episode.started',
      occurredAt: iso(boundaryTimestampMs),
      sourceSequence: 0,
      sourceKey: sourceEventKey(hmacKey, {
        kind: 'episode.started',
        sourceInstanceId,
        sessionId: episode.sessionId,
        anchorHmac: episode.anchorHmac,
      }),
      episodeId: episode.episodeId,
      confidence,
      payload: {
        source_session_hmac: sessionHmac(sourceInstanceId, episode.sessionId, hmacKey),
        source_turn_hmac: episode.anchor ? episode.anchorHmac : null,
        principal_hmac: null,
        profile_hmac: null,
        model: publicModelId(session.model),
        provider: publicProviderId(session.billing_provider),
        environment_fingerprint: null,
        task_class_hmac: null,
        authorized_view_fingerprint: null,
        boundary_method: episode.anchor?.boundaryMethod ?? 'session_fallback_by_source_order_v0',
      },
    }));
  }
  return { episodes, events };
}

function buildOperationAndAttemptEvents(records, sourceInstanceId, hmacKey, makeEvent) {
  const operationEvents = [];
  const attemptEvents = [];
  for (const record of records) {
    record.operationId = deterministicId('hermes-operation', {
      sourceInstanceId,
      sourceToolCallHmac: record.toolCallHmac,
    });
    record.attemptId = deterministicId('hermes-attempt', {
      sourceInstanceId,
      sourceToolCallHmac: record.toolCallHmac,
    });
    const episodeOperationKey = record.operation.episodeOperationSignature
      ? hmacSha256({
        namespace: 'hermes-episode-operation-v1',
        episodeId: record.episodeId,
        stableOperationSignature: record.operation.episodeOperationSignature,
      }, hmacKey)
      : hmacSha256({
        namespace: 'hermes-episode-operation-per-call-v1',
        episodeId: record.episodeId,
        sourceToolCallHmac: record.toolCallHmac,
      }, hmacKey);
    operationEvents.push(makeEvent({
      eventType: 'tool.operation',
      occurredAt: iso(record.eventTimestampMs),
      sourceSequence: record.episodeSourceOrdinal,
      sourceKey: sourceEventKey(hmacKey, {
        kind: 'tool.operation',
        sourceInstanceId,
        sessionId: record.transientSessionId,
        toolCallId: record.transientToolCallId,
      }),
      episodeId: record.episodeId,
      confidence: record.operation.groupable ? 0.8 : 0.55,
      payload: {
        operation_id: record.operationId,
        tool_name: record.operation.toolName,
        normalized_operation: record.operation.normalizedOperation,
        target_class: record.operation.targetClass,
        target_hmac: record.operation.targetHmac,
        source_tool_call_hmac: record.toolCallHmac,
        episode_operation_key: episodeOperationKey,
        operation_signature: record.operation.operationSignature,
        idempotency_key_hash: null,
        derivation_method: record.operation.derivationMethod,
      },
    }));
    const confidence = Math.max(0.2, (record.result.decisive ? 0.85 : 0.45) - (record.timestampAmbiguous ? 0.15 : 0));
    const errorClassification = classifyAttemptError(record.result);
    attemptEvents.push(makeEvent({
      eventType: 'tool.attempt',
      occurredAt: iso(record.eventTimestampMs),
      sourceSequence: record.episodeSourceOrdinal,
      sourceKey: sourceEventKey(hmacKey, {
        kind: 'tool.attempt',
        sourceInstanceId,
        sessionId: record.transientSessionId,
        toolCallId: record.transientToolCallId,
      }),
      episodeId: record.episodeId,
      confidence,
      payload: {
        attempt_id: record.attemptId,
        operation_id: record.operationId,
        tool_name: record.operation.toolName,
        source_tool_call_hmac: record.toolCallHmac,
        status: record.result.status,
        runtime_status: record.result.runtimeStatus,
        runtime_error_code: record.result.runtimeErrorCode,
        started_at: iso(record.eventTimestampMs),
        ended_at: null,
        duration_ms: null,
        effect_disposition: record.result.effectDisposition,
        ...(errorClassification ?? {}),
      },
    }));
  }
  return { operationEvents, attemptEvents };
}

function buildSkillEvents(records, sourceInstanceId, hmacKey, makeEvent, warnings) {
  const events = [];
  for (const record of records) {
    if (record.operation.toolName !== 'skill_view') continue;
    const request = record.operation.skillRequest;
    const requestedName = safeLabel(request?.requestedName);
    const resolvedName = safeLabel(firstString(record.transientResult, ['name', 'skill_name']) ?? requestedName);
    if (!requestedName || !resolvedName) {
      warnings.add('skill_identity_unrecoverable');
      continue;
    }
    const isReference = Boolean(request?.filePath);
    const observationStatus = ['succeeded', 'failed', 'blocked'].includes(record.result.status)
      ? record.result.status
      : 'unknown';
    const successful = observationStatus === 'succeeded';
    const skill = unresolvedSkillIdentity({
      identity: {
        source_runtime: 'hermes',
        source_instance_id: sourceInstanceId,
        source_channel: 'hermes-local',
        source_authority: 'local',
        source_package: 'hermes-skills',
        native_skill_id: resolvedName,
      },
      nameSnapshot: resolvedName,
      hmacKey,
      method: firstString(record.transientResult, ['name', 'skill_name'])
        ? 'historical_skill_view_result_v0'
        : 'historical_skill_view_request_v0',
    });
    const activationPayloadSha256 = record.result.structured && record.transientResultContent
      ? sha256Bytes(record.transientResultContent)
      : null;
    events.push(makeEvent({
      eventType: 'skill.stage',
      occurredAt: iso(record.transientResultTimestampMs ?? record.eventTimestampMs),
      sourceSequence: record.skillResultSourceOrdinal ?? record.episodeSourceOrdinal,
      sourceKey: sourceEventKey(hmacKey, {
        kind: isReference ? 'skill.stage.reference' : 'skill.stage.loaded',
        sourceInstanceId,
        sessionId: record.transientSessionId,
        toolCallId: record.transientToolCallId,
      }),
      episodeId: record.episodeId,
      confidence: Math.max(0.3, (isReference ? 0.65 : 0.75)
        - (successful ? 0 : 0.2)
        - (record.timestampAmbiguous ? 0.1 : 0)),
      payload: {
        stage: isReference ? 'exposed' : 'loaded',
        status: observationStatus,
        skill,
        load_mode: isReference ? 'skill_view_reference' : 'skill_view',
        activation_scope: successful ? (isReference ? 'turn' : 'episode') : 'unknown',
        active_from: successful ? iso(record.transientResultTimestampMs ?? record.eventTimestampMs) : null,
        active_through: null,
        activation_payload_sha256: activationPayloadSha256,
        source_tool_call_hmac: record.toolCallHmac,
        requested_skill_alias_hmac: hmacSha256({
          namespace: 'hermes-requested-skill-alias-v0',
          sourceInstanceId,
          requestedName,
        }, hmacKey),
        derivation_method: isReference
          ? 'historical_skill_view_reference_v0'
          : 'historical_skill_view_primary_v0',
      },
    }));
  }
  return events;
}

function verificationKind(kind) {
  const normalized = typeof kind === 'string' ? kind.trim().toLowerCase() : '';
  if (['test', 'tests', 'pytest'].includes(normalized)) return 'test_command';
  if (['build', 'compile'].includes(normalized)) return 'build_command';
  if (['lint', 'typecheck', 'type_check'].includes(normalized)) return `${normalized.replace('_', '')}_command`;
  return 'command_verification';
}

function verificationEvidenceSemantics(kind, exitCode) {
  const evidenceType = verificationKind(kind);
  const deterministic = Number.isInteger(exitCode)
    && ['test_command', 'build_command', 'lint_command', 'typecheck_command'].includes(evidenceType);
  return deterministic
    ? { evidenceType, strength: 1, independenceClass: 'independent' }
    : { evidenceType, strength: 6, independenceClass: 'runtime_assertion' };
}

function readVerificationSource(db) {
  requireColumns(db, 'verification_events', [
    'id', 'created_at', 'session_id', 'root', 'command', 'canonical_command', 'kind', 'status', 'exit_code',
  ]);
  const events = db.prepare(`
    SELECT id, created_at, session_id, root, command, canonical_command, kind, status, exit_code
    FROM verification_events
    ORDER BY id
  `).all();
  const stateColumns = tableColumns(db, 'verification_state');
  const states = stateColumns && ['session_id', 'root', 'last_edit_at'].every((field) => stateColumns.has(field))
    ? db.prepare('SELECT session_id, root, last_edit_at FROM verification_state').all()
    : [];
  return { events, states };
}

function buildVerificationEvents({
  verificationSource,
  records,
  allRecords,
  sourceInstanceId,
  hmacKey,
  runtimeVersion,
  makeEvent,
  verificationWindowMs,
  warnings,
}) {
  const stateMap = new Map(verificationSource.states.map((row) => [`${row.session_id}\u0000${row.root}`, row]));
  const candidateUniverse = allRecords.filter((record) => record.operation.toolName === 'terminal'
    && typeof record.operation.transientTarget === 'string');
  const included = new Set(records.map((record) => record.toolCallHmac));
  const evidenceEvents = [];
  let ambiguous = 0;
  let stale = 0;
  let unmatched = 0;

  for (const verification of verificationSource.events) {
    const occurredMs = toMillis(verification.created_at);
    if (occurredMs === null || typeof verification.command !== 'string') {
      warnings.add('verification_record_invalid');
      unmatched += 1;
      continue;
    }
    const state = stateMap.get(`${verification.session_id}\u0000${verification.root}`);
    const lastEditMs = toMillis(state?.last_edit_at);
    if (lastEditMs !== null && lastEditMs > occurredMs) {
      warnings.add('verification_stale_after_edit');
      stale += 1;
      continue;
    }
    const matches = candidateUniverse.filter((record) => {
      const attemptTime = record.transientResultTimestampMs ?? record.originalTimestampMs ?? record.eventTimestampMs;
      if (record.transientSessionId !== verification.session_id) return false;
      if (record.operation.transientTarget !== verification.command) return false;
      if (Math.abs(occurredMs - attemptTime) > verificationWindowMs) return false;
      return record.result.exitCode === null
        || !Number.isInteger(verification.exit_code)
        || record.result.exitCode === verification.exit_code;
    });
    if (matches.length !== 1) {
      if (matches.length > 1) {
        warnings.add('verification_join_ambiguous');
        ambiguous += 1;
      } else {
        warnings.add('verification_join_unmatched');
        unmatched += 1;
      }
      continue;
    }
    const subject = matches[0];
    if (!included.has(subject.toolCallHmac) || !subject.attemptId || !subject.episodeId) {
      warnings.add('verification_join_outside_window');
      unmatched += 1;
      continue;
    }
    const eventTime = occurredMs;
    const verificationTimeAmbiguous = eventTime <= subject.eventTimestampMs;
    if (verificationTimeAmbiguous) warnings.add('verification_timestamp_regression');
    const verificationHmac = hmacSha256({
      namespace: 'hermes-verification-event-v0',
      sourceInstanceId,
      verificationEventId: verification.id,
      sessionId: verification.session_id,
    }, hmacKey);
    const evidenceId = deterministicId('hermes-verification-evidence', {
      sourceInstanceId,
      verificationHmac,
    });
    const status = typeof verification.status === 'string' ? verification.status.trim().toLowerCase() : '';
    const result = Number.isInteger(verification.exit_code)
      ? (verification.exit_code === 0 ? 'pass' : 'fail')
      : (['passed', 'success', 'succeeded'].includes(status) ? 'pass'
        : (['failed', 'error'].includes(status) ? 'fail' : 'unknown'));
    evidenceEvents.push(makeEvent({
      eventType: 'evidence.observed',
      occurredAt: iso(eventTime),
      sourceSequence: null,
      sourceKey: sourceEventKey(hmacKey, {
        kind: 'evidence.observed',
        sourceInstanceId,
        verificationHmac,
      }),
      episodeId: subject.episodeId,
      confidence: Math.max(0.35, (subject.result.exitCode === null ? 0.6 : 0.75)
        - (verificationTimeAmbiguous ? 0.15 : 0)),
      payload: (() => {
        const semantics = verificationEvidenceSemantics(verification.kind, verification.exit_code);
        return {
        evidence_id: evidenceId,
        subject_type: 'attempt',
        subject_id: subject.attemptId,
        source_tool_call_hmac: subject.toolCallHmac,
        evidence_type: semantics.evidenceType,
        result,
        verifier_id: 'hermes-verification-evidence',
        verifier_version: runtimeVersion,
        artifact_hash: null,
        state_hash: null,
        strength: semantics.strength,
        independence_class: semantics.independenceClass,
        redacted_locator: hmacSha256({
          namespace: 'hermes-verification-locator-v0',
          sourceInstanceId,
          verificationHmac,
        }, hmacKey),
        derivation_method: 'session_command_time_exit_join_v0',
        };
      })(),
    }));
  }
  return {
    events: evidenceEvents,
    stats: {
      verification_records_seen: verificationSource.events.length,
      verification_evidence_emitted: evidenceEvents.length,
      verification_ambiguous: ambiguous,
      verification_stale: stale,
      verification_unmatched: unmatched,
    },
  };
}

/**
 * Read-only Hermes Phase 0 historical extraction.
 *
 * @param {object} options
 * @param {string} options.stateDbPath Hermes state.db path.
 * @param {string} [options.verificationDbPath] Optional verification_evidence.db path.
 * @param {string} options.sourceInstanceId Explicitly registered opaque source UUID.
 * @param {string} [options.runtimeVersion='0.18.2'] Hermes runtime version.
 * @param {string|Buffer} options.hmacKey Pseudonymization key (minimum 32 bytes).
 * @param {string} options.pseudonymKeyVersion Stable key version label.
 * @param {string|number|Date} [options.since] Inclusive occurrence boundary.
 * @param {string|number|Date} [options.until] Exclusive occurrence boundary.
 * @param {number} [options.verificationWindowMs=10000] Maximum exact-join time distance.
 * @returns {{events: object[], quarantined: object[], warnings: object[], stats: object,
 *   capabilityCoverage: object, batchMetadata: object, sourceSchemaVersion: string,
 *   sourceSnapshotSha256: null}}
 */
export function extractHermesHistory({
  stateDbPath,
  verificationDbPath = null,
  sourceInstanceId,
  runtimeVersion = 'unknown',
  hmacKey,
  pseudonymKeyVersion,
  since = null,
  until = null,
  verificationWindowMs = 10_000,
  bounds = null,
  sessionIds = null,
}) {
  if (!UUID_PATTERN.test(String(sourceInstanceId ?? ''))) {
    throw new TypeError('sourceInstanceId must be an explicitly registered opaque UUID');
  }
  if (!SAFE_VERSION_PATTERN.test(String(runtimeVersion ?? ''))) throw new TypeError('runtimeVersion is invalid');
  if (!SAFE_VERSION_PATTERN.test(String(pseudonymKeyVersion ?? ''))) throw new TypeError('pseudonymKeyVersion is invalid');
  requireHmacKey(hmacKey);
  if (!Number.isFinite(verificationWindowMs) || verificationWindowMs < 0 || verificationWindowMs > 300_000) {
    throw new TypeError('verificationWindowMs must be between 0 and 300000');
  }
  const sinceMs = parseBoundary(since, 'since');
  const untilMs = parseBoundary(until, 'until');
  if (sinceMs !== null && untilMs !== null && sinceMs >= untilMs) {
    throw new TypeError('since must be earlier than until');
  }

  const stateDb = openReadonlyDatabase(stateDbPath, 'Hermes state database');
  let stateSource;
  try {
    if (bounds && verificationDbPath) throw new TypeError('bounded history does not permit unbounded verification reads');
    stateSource = stateDb.transaction(() => sessionIds !== null
      ? {...readSelectedHistory(stateDb,{sessionIds,sinceMs,untilMs,bounds}),sourceSchemaVersion:`hermes-state-${tableColumns(stateDb,'schema_version')?.has('version') ? stateDb.prepare('SELECT MAX(version) v FROM schema_version').get().v : stateDb.pragma('user_version',{simple:true})}`}
      : readStateSource(stateDb, bounds, sinceMs, untilMs))();
  } finally {
    stateDb.close();
  }
  const reduction = reduceHermesToolRows({
    callRows: stateSource.callRows,
    resultRows: stateSource.resultRows,
    sourceInstanceId,
    hmacKey,
  });
  const sessionMap = new Map(stateSource.sessions.map((row) => [row.id, row]));
  const warnings = warningCounter();
  assignChronology(reduction.reduced, sessionMap, warnings);
  const inWindow = reduction.reduced.filter((record) => {
    const occurrence = record.originalTimestampMs ?? record.eventTimestampMs;
    return (sinceMs === null || occurrence >= sinceMs) && (untilMs === null || occurrence < untilMs);
  });
  const usersBySession = groupUsersBySession(
    stateSource.userRows,
    sourceInstanceId,
    hmacKey,
    warnings,
  );
  const quarantinedInWindow = reduction.quarantined
    .filter((record) => {
      const occurrence = record.transientOccurrenceMs
        ?? toMillis(sessionMap.get(record.transientSessionId)?.started_at)
        ?? 0;
      return (sinceMs === null || occurrence >= sinceMs) && (untilMs === null || occurrence < untilMs);
    })
    .map((record) => {
      const { transientSessionId, transientEarliestRowId, transientOccurrenceMs, ...safe } = record;
      const identity = episodeIdentity(
        transientSessionId,
        transientEarliestRowId,
        usersBySession,
        sourceInstanceId,
        hmacKey,
      );
      return { ...safe, episode_id: identity.episodeId };
    });
  const makeEvent = baseEventFactory({ sourceInstanceId, runtimeVersion, pseudonymKeyVersion });
  const episodeOutput = buildEpisodes(
    inWindow,
    usersBySession,
    sessionMap,
    sourceInstanceId,
    hmacKey,
    makeEvent,
  );
  const toolOutput = buildOperationAndAttemptEvents(inWindow, sourceInstanceId, hmacKey, makeEvent);
  const skillEvents = buildSkillEvents(inWindow, sourceInstanceId, hmacKey, makeEvent, warnings);

  let verificationOutput = {
    events: [],
    stats: {
      verification_records_seen: 0,
      verification_evidence_emitted: 0,
      verification_ambiguous: 0,
      verification_stale: 0,
      verification_unmatched: 0,
    },
  };
  if (verificationDbPath && sinceMs === null && untilMs === null) {
    const verificationDb = openReadonlyDatabase(verificationDbPath, 'Hermes verification database');
    let verificationSource;
    try {
      verificationSource = verificationDb.transaction(() => readVerificationSource(verificationDb))();
    } finally {
      verificationDb.close();
    }
    verificationOutput = buildVerificationEvents({
      verificationSource,
      records: inWindow,
      allRecords: reduction.reduced,
      sourceInstanceId,
      hmacKey,
      runtimeVersion,
      makeEvent,
      verificationWindowMs,
      warnings,
    });
  }

  const events = [
    ...episodeOutput.events,
    ...toolOutput.operationEvents,
    ...toolOutput.attemptEvents,
    ...skillEvents,
    ...verificationOutput.events,
  ].sort((left, right) => left.episode_id.localeCompare(right.episode_id)
    || (left.source_sequence ?? Number.MAX_SAFE_INTEGER) - (right.source_sequence ?? Number.MAX_SAFE_INTEGER)
    || left.event_type.localeCompare(right.event_type)
    || left.occurred_at.localeCompare(right.occurred_at)
    || left.source_event_key.localeCompare(right.source_event_key));
  if (verificationDbPath && (sinceMs !== null || untilMs !== null)) warnings.add('verification_join_disabled_for_filtered_source');
  const coverage = capabilityCoverage(Boolean(verificationDbPath) && sinceMs === null && untilMs === null);
  const batchMetadata = {
    schema_version: SCHEMA_VERSION,
    source_runtime: 'hermes',
    runtime_version: runtimeVersion,
    source_instance_id: sourceInstanceId,
    adapter_id: HERMES_HISTORY_ADAPTER_ID,
    adapter_version: HERMES_HISTORY_ADAPTER_VERSION,
    capture_mode: 'historical',
    redaction_policy_version: REDACTION_POLICY_VERSION,
    pseudonym_key_version: pseudonymKeyVersion,
  };
  return {
    events,
    quarantined: quarantinedInWindow,
    warnings: mergeWarnings(reduction.warnings, warnings.list()),
    stats: {
      ...reduction.stats,
      tool_identities_outside_window: reduction.reduced.length - inWindow.length,
      quarantined_tool_identities: quarantinedInWindow.length,
      quarantined_tool_identities_outside_window: reduction.quarantined.length - quarantinedInWindow.length,
      episodes_emitted: episodeOutput.events.length,
      operations_emitted: toolOutput.operationEvents.length,
      attempts_emitted: toolOutput.attemptEvents.length,
      skill_stage_events_emitted: skillEvents.length,
      events_emitted: events.length,
      ...verificationOutput.stats,
    },
    capabilityCoverage: coverage,
    batchMetadata,
    sourceSchemaVersion: stateSource.sourceSchemaVersion,
    sourceSnapshotSha256: null,
    sourceReadBounds: stateSource.sourceReadBounds,
  };
}
