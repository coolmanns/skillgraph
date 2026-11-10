import { canonicalize } from './canonical-json.js';
import { enforcePrivacy } from './privacy.js';
import { sha256Bytes } from './hashes.js';
import { deterministicId } from './ids.js';
import { eventContentForHash, validateAdapterEvent, validateStoredEvent } from './schema.js';

export const SCHEMA_VERSION = 'skillgraph.telemetry.v0';
export const REDACTION_POLICY_VERSION = 'skillgraph.redaction.v0';

const LOADER_OWNED_FIELDS = new Set(['ingested_at', 'payload_hash', 'event_content_hash', 'ingest_batch_id']);

export function buildStoredEvent(input, { ingestedAt = new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Telemetry adapter event must be an object');
  }
  for (const field of LOADER_OWNED_FIELDS) {
    if (Object.hasOwn(input, field)) {
      throw new TypeError(`${field} is loader-owned and must not be supplied by an adapter`);
    }
  }

  const adapterEvent = {
    supersedes_event_id: null,
    trace_id: null,
    span_id: null,
    parent_span_id: null,
    episode_id: null,
    source_sequence: null,
    ...input,
    schema_version: input.schema_version ?? SCHEMA_VERSION,
    redaction_policy_version: input.redaction_policy_version ?? REDACTION_POLICY_VERSION,
  };

  if (!adapterEvent.event_id) {
    adapterEvent.event_id = deterministicId('event', {
      source_instance_id: adapterEvent.source_instance_id,
      source_event_key: adapterEvent.source_event_key,
      event_type: adapterEvent.event_type,
    });
  }

  enforcePrivacy(adapterEvent);
  validateAdapterEvent(adapterEvent);
  const payloadHash = sha256Bytes(canonicalize(adapterEvent.payload));
  const stored = {
    ...adapterEvent,
    ingested_at: ingestedAt,
    payload_hash: payloadHash,
  };
  stored.event_content_hash = sha256Bytes(canonicalize(eventContentForHash(stored)));
  validateStoredEvent(stored);
  return stored;
}
