# Collector offline core — draft, NOT ready for live use

This is a deliberately bounded migration, not the entire local Collector or a deployment.
It provides read-only history extraction, reduction/classification, privacy/event schemas,
source-bound evaluation-case validation, literal receipt predicates and derived wrapper attribution.
No historical data, runtime integration, collector CLI, evidence store, deployment configuration,
or operational mapping is included. The root SkillGraph resolver is unchanged.

## Reproduce synthetic verification

Use Node 24, npm, Python 3 and a C/C++ build toolchain. From the repository root:

```sh
npm --prefix telemetry ci --ignore-scripts --no-audit --no-fund
npm_config_build_from_source=true npm --prefix telemetry rebuild better-sqlite3 --foreground-scripts
npm --prefix telemetry test
```

Dependency installation fetches public packages and Node headers; the tests themselves are
hermetic synthetic cases, with SQLite fixtures created in unique temporary directories.
They neither read private history nor execute commands represented in fixture content.
Set `TMPDIR` to an approved local scratch directory when needed.
No API keys, services, model calls or production databases are required.

## Synthetic regression gate

The default test command runs **all included tests**, including `parent-*.test.mjs`.
Initial migration verification: **33 tests, 29 pass, 4 fail, no skips/todos**.

- `verified_success` accepts an empty acceptance list.
- `verified_success` accepts assistant-claim-only support.
- ISO timestamp rounding admits an exclusive-until result into selected extraction.
- Bounded generic extraction does not reject a source missing profile membership.

The approved repair pass fixes these four failures plus the subsequently reproduced patch retry
identity defect. Current full gate: **108 tests, 108 pass, 0 fail, no skips/todos**. Positive controls,
role/source spoof rejection, sub-millisecond boundaries, body-read sentinels and synthetic replay
are included. The older `collector-bounds` fixture now declares its actual default profile rather
than relying on unverifiable membership. No test is skipped or marked expected-failure.

`npm --prefix telemetry run test:unit` is a diagnostic subset, never the readiness gate.
`npm --prefix telemetry run test:acceptance` runs the expanded parent suites only, not patch tests.

### Deliberate compatibility limits

- Any row/session/date-scoped extraction fails closed on unavailable profile membership and
  includes only `default` profile sessions. Specialist-profile support remains deferred.
- The legacy call with `bounds`, `sessionIds`, `since`, and `until` all null retains unbounded,
  profile-unverified behavior for compatibility. It is **not** an authorized collection route.
- Time windows use exact decimal comparisons before body materialization, inclusive since and
  exclusive until. Numbers and decimal numeric text use the legacy seconds/milliseconds threshold
  (values below 10,000,000,000 mean seconds); zoned ISO supports fractional seconds. Numeric values
  cannot recover precision already lost in SQLite/JavaScript storage. Metadata/event display times
  remain approximate/rounded and do not decide selection. Invalid or unsupported source timestamps
  are omitted by date filters; invalid boundaries throw. Zoned calendar dates are validated;
  timezone-free ISO is rejected. Text/exponent precision is bounded (128 characters/exponent scale)
  and numeric instants outside the JavaScript Date range are unsupported.
- Patch retry keys include literal path, edit payload, mode and replace-all intent. Equivalent
  aliases/defaults normalize; mixed, malformed, truncated or unknown fields are not groupable.
  Coarse path signatures are analytics only, not retry evidence. Patch text is not executed or
  semantically validated. Re-extraction can change derived keys/build hashes; old records stay intact.
- `verified_success` requires every predicate to be supported by at least one referenced,
  role-checked/source-bound tool result, GREEN test, readback, human feedback, skill load or edit.
  Claims, notifications, compaction and RED tests alone are insufficient. Mixed evidence is allowed;
  actual receipt content and predicate relevance still need review. Partial/unknown cases stay valid.

## Evidence is not truth

Tool success does not establish task success or correct skill selection. Historical catalogs,
exact skill versions and unchosen outcomes remain unknown. A valid review record is not a
semantic gold label. Extraction can produce sensitive labels or metadata even with keyed IDs:
never publish historical output simply because it has been pseudonymized. Default-profile
scope, limited session-ID formats, legacy unbounded APIs and optional verification reads
also require review before any pilot. The exported API has no implicit live source path.

See [migration audit](../docs/COLLECTOR-MIGRATION.md) and [branch handoff](../BRANCH-README.md).
