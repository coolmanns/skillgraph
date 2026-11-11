import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { canonicalize } from './canonical-json.js';
import { hashesEqual, sha256Bytes } from './hashes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaDirectory = path.resolve(here, '..', 'schema');

function readSchema(filename) {
  return JSON.parse(fs.readFileSync(path.join(schemaDirectory, filename), 'utf8'));
}

const enumsSchema = readSchema('enums.schema.json');
const eventSchema = readSchema('event.v0.schema.json');
const adapterEventSchema = readSchema('adapter-event.v0.schema.json');
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(enumsSchema);
ajv.addSchema(eventSchema);
const validateStored = ajv.getSchema(eventSchema.$id);
const validateAdapter = ajv.compile(adapterEventSchema);

export class SchemaValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'SchemaValidationError';
    this.code = 'schema_invalid';
    this.errors = errors;
  }
}

function collectSkillIdentities(event) {
  const payload = event.payload;
  switch (event.event_type) {
    case 'skill.stage':
    case 'constraint.evaluated':
      return [payload.skill];
    case 'routing.decided':
      return payload.selected_skill ? [payload.selected_skill] : [];
    case 'skill.plan.created':
      return payload.skills.map((node) => node.skill);
    case 'experiment.assigned':
      return payload.skill ? [payload.skill] : [];
    default:
      return [];
  }
}

function assertSkillIdentity(identity, event) {
  const artifactFields = [
    'artifact_sha256',
    'artifact_scope',
    'hash_provenance',
    'artifact_observed_at',
  ];
  const hasArtifact = identity.artifact_sha256 !== null && identity.artifact_sha256 !== undefined;
  const completeArtifact = artifactFields.every((field) => identity[field] !== null && identity[field] !== undefined);
  const emptyArtifact = artifactFields.every((field) => identity[field] === null || identity[field] === undefined);
  if ((hasArtifact && !completeArtifact) || (!hasArtifact && !emptyArtifact)) {
    throw new SchemaValidationError('Artifact identity must be entirely present or entirely null');
  }
  if (identity.normalized_content_hash && !identity.normalizer_version) {
    throw new SchemaValidationError('normalized_content_hash requires normalizer_version');
  }
  if ((identity.normalized_content_hash || identity.normalizer_version) && !hasArtifact) {
    throw new SchemaValidationError('Normalized content identity requires the corresponding exact artifact evidence');
  }
  if (identity.skill_uid && !identity.identity_review_ref) {
    throw new SchemaValidationError('skill_uid requires reviewed identity provenance');
  }
  if (identity.revision_id && (!identity.skill_uid || !identity.identity_review_ref || !hasArtifact)) {
    throw new SchemaValidationError('revision_id requires reviewed canonical identity and exact artifact evidence');
  }
  if (event.capture_mode === 'historical' && hasArtifact) {
    throw new SchemaValidationError('Historical v0 events cannot carry artifact or revision identity without a future verified snapshot registry');
  }
  if (hasArtifact && Date.parse(identity.artifact_observed_at) > Date.parse(event.occurred_at)) {
    throw new SchemaValidationError('Artifact evidence cannot postdate the event');
  }
}

function assertEventSemantics(event) {
  for (const identity of collectSkillIdentities(event)) assertSkillIdentity(identity, event);

  if (event.event_type === 'routing.decided') {
    const { decision, selected_skill: selectedSkill, randomized, selection_probability: probability } = event.payload;
    if (decision === 'selected' && !selectedSkill) {
      throw new SchemaValidationError('A selected routing decision requires selected_skill');
    }
    if (decision !== 'selected' && selectedSkill) {
      throw new SchemaValidationError('Only a selected routing decision may carry selected_skill');
    }
    if (randomized === true && probability === null) {
      throw new SchemaValidationError('Randomized routing requires selection_probability');
    }
  }

  if (event.event_type === 'outcome.assessed') {
    const { action, target_assessment_id: target } = event.payload;
    if ((action === 'assert' && target) || (action !== 'assert' && !target)) {
      throw new SchemaValidationError('Outcome supersession/retraction target is inconsistent with action');
    }
  }

  if (event.event_type === 'tool.attempt') {
    const fields = [
      'error_class', 'responsibility_class', 'classifier_id', 'classifier_version',
      'classifier_hash', 'classification_confidence', 'classification_method',
    ];
    const present = fields.filter((field) => event.payload[field] !== null && event.payload[field] !== undefined);
    if (present.length > 0 && present.length !== fields.length) {
      throw new SchemaValidationError('Tool-attempt error classification must be entirely present or entirely null');
    }
    if (event.payload.status === 'succeeded' && present.length > 0) {
      throw new SchemaValidationError('A succeeded tool attempt cannot carry error classification');
    }
  }

  if (event.event_type === 'experiment.assigned') {
    const { treatment, skill, assignment_probability: probability } = event.payload;
    if (treatment === 'no_skill' && skill !== null) {
      throw new SchemaValidationError('A no_skill experiment treatment cannot carry Skill identity');
    }
    if (treatment === 'skill_version') {
      if (!skill?.skill_uid || !skill.revision_id || !skill.artifact_sha256) {
        throw new SchemaValidationError('A skill_version treatment requires reviewed exact Skill-version identity');
      }
    }
    if (!(probability > 0 && probability < 1)) {
      throw new SchemaValidationError('Experiment assignment_probability must be strictly between 0 and 1');
    }
  }
}

export function eventContentForHash(event) {
  const copy = { ...event };
  delete copy.event_id;
  delete copy.ingested_at;
  delete copy.event_content_hash;
  return copy;
}

export function validateStoredEvent(event) {
  if (!validateStored(event)) {
    throw new SchemaValidationError('Telemetry event failed JSON Schema validation', validateStored.errors ?? []);
  }

  const expectedPayloadHash = sha256Bytes(canonicalize(event.payload));
  if (!hashesEqual(expectedPayloadHash, event.payload_hash)) {
    throw new SchemaValidationError('payload_hash does not match the canonical privacy-filtered payload');
  }
  const expectedContentHash = sha256Bytes(canonicalize(eventContentForHash(event)));
  if (!hashesEqual(expectedContentHash, event.event_content_hash)) {
    throw new SchemaValidationError('event_content_hash does not match the immutable normalized envelope');
  }
  assertEventSemantics(event);
  return event;
}

export function validateAdapterEvent(event) {
  if (!validateAdapter(event)) {
    throw new SchemaValidationError('Telemetry adapter event failed JSON Schema validation', validateAdapter.errors ?? []);
  }
  return event;
}

export function formatSchemaErrors(error) {
  if (!(error instanceof SchemaValidationError) || error.errors.length === 0) return error.message;
  return error.errors
    .slice(0, 8)
    .map((item) => `${item.instancePath || '/'} ${item.message}`)
    .join('; ');
}
