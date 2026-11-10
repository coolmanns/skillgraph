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

## Blocking behavior retained as real failures

The default test command runs **all included tests**, including `parent-*.test.mjs`.
Initial migration verification: **33 tests, 29 pass, 4 fail, no skips/todos**.

- `verified_success` accepts an empty acceptance list.
- `verified_success` accepts assistant-claim-only support.
- ISO timestamp rounding admits an exclusive-until result into selected extraction.
- Bounded generic extraction does not reject a source missing profile membership.

The positive controls and role-spoofing rejection pass. These are implementation failures,
not expected-failure wrappers. CI must stay red until separately reviewed fixes satisfy them.
The older `collector-bounds` test also assumes missing-profile sources are accepted; its fixture
will need an explicit profile when implementing fail-closed behavior, not removal of the new gate.

`npm --prefix telemetry run test:unit` is a diagnostic subset, never the readiness gate.
`npm --prefix telemetry run test:acceptance` runs the seven parent checks alone.

## Evidence is not truth

Tool success does not establish task success or correct skill selection. Historical catalogs,
exact skill versions and unchosen outcomes remain unknown. A valid review record is not a
semantic gold label. Extraction can produce sensitive labels or metadata even with keyed IDs:
never publish historical output simply because it has been pseudonymized. Default-profile
hardcoding, limited session-ID formats, legacy unbounded APIs and optional verification reads
also require review before any pilot. The exported API has no implicit live source path.

See [migration audit](../docs/COLLECTOR-MIGRATION.md) and [branch handoff](../BRANCH-README.md).
