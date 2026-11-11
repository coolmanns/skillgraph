# Audited Collector migration

> This document preserves the initial migration audit and its real red baseline. The subsequent
> authorized five-defect repair pass is documented in [COLLECTOR-REPAIRS.md](COLLECTOR-REPAIRS.md):
> 133 synthetic tests pass after R1/R2 review corrections; R3 duplicate-conflict loss remains
> a broader integrity blocker and independent rereview is pending. Original manifest import hashes
> remain unchanged; appended repair
> hashes identify current bytes. Prior missing-index/failure statements below describe the
> migration checkpoint, not current repair status. This is still a draft, not readiness approval.

## Provenance and choice

Base: public `coolmanns/skillgraph` main, `0090e4b16f82717816b78c1f74f62e214619a0fa`.
The existing legacy checkout had the same HEAD but extensive uncommitted changes; it was
not used as a migration payload. Its tracked diff comprised 11 files (2,364 insertions,
308 deletions) at inventory time, plus untracked runtime work and private/generated files.
The current Collector directory had no Git metadata. A fresh clone preserves upstream history
and avoids either treating an index as version control or blessing the dirty legacy tree.

The bounded unit selected is the offline extractor and evidence-contract dependency closure.
Every selected source, schema, test and lockfile was read before migration. No implementation
fixes or historical cases were imported. The manifest records original and migrated SHA-256
values for each copied/adapted file, with source-relative provenance and explicit adaptations.
New package scripts, docs and CI are authored for this branch rather than copied from operational
instructions. Source hashes prove byte provenance, not independent correctness approval.

## Included/audited

- `telemetry/src/adapters/{hermes-history,hermes-selection}.js` and their import closure:
  canonical JSON, classifiers, event, hashes, reducer, identity, IDs, privacy and schema validation.
- Evaluation contract, receipt validator, wrapper-attribution implementation.
- Three event/enumeration schemas and the redaction policy declaration (not activation policy).
- Synthetic unit tests for these modules and the portable parent regression suites.
- Exact existing dependency lock; a narrower private package manifest exposes tests only.

No secrets, private narrative, operational identifiers or live source paths were found in the
selected production files. Synthetic test keys/sentinels are intentionally public test data.
Historical-looking session identifiers in selected extraction tests were replaced by explicitly
synthetic identifiers. No historical content was converted into public fixtures.

Adaptations: selected-history's extraction tests only were retained; its CLI test is deferred
with the excluded CLI. The helper keeps pure event builders but omits database/migration helpers.
Parent tests use relative imports and temporary synthetic databases with cleanup; their
assertions and timestamp boundary are preserved. The acceptance fixture includes the required
`decision_row_id` so negative checks do not pass due to an unrelated invalid fixture.

## Excluded and deferred (not accepted for publication)

| Area | Disposition |
| --- | --- |
| `artifacts/`, `reports/`, `runtime-snapshot/`, `.test-scratch/`, `.gitnexus/` | Excluded private/generated roots; only the explicitly inspected synthetic acceptance fixture was adapted out of reports |
| History/corpus exports, reviewer labels, source locators, keys, DBs/backups, operational mappings/configuration | Never copied or pushed, including pseudonymized historical cases |
| Collector CLI/dev/export, database/migrations/loader/projector, spool/live/shadow producers, erasure/registry/health | Deferred to separate bounded audit; not implied by this core migration |
| Hermes Python and OpenClaw integrations, native smoke/runtime scripts | Deferred; no live or installed runtime tests executed |
| Existing historical fixture JSON and remaining telemetry tests | Deferred, not blanket classified synthetic |
| Dirty legacy resolver, seed/init changes, embedding/vector/catalog work, generators, scripts, operational reports and tests | Inventory only; original checkout untouched, no local changes copied |
| Existing public root files | Preserved baseline, not re-certified as safe runtime commands; PROJECT status gets a clarifying banner |

## Dependency and execution audit

The exact lock resolves only public npm registry tarballs. Installation uses `--ignore-scripts`.
The only discovered dependency install hook is better-sqlite3 12.11.1:
`prebuild-install || node-gyp rebuild --release`. Its package metadata, prebuild entry/config,
GYP build actions and SQLite copy helper were inspected. The authorized rebuild is restricted
to this package with build-from-source enabled: no prebuilt binary download, no product runtime
activation. Node-gyp can fetch public Node headers. Native build warnings are upstream compiler
warnings; npm 11 warns that this environment option will stop working in its next major version.
`prebuild-install` is deprecated; dependency-policy modernization remains a follow-up, not a
silent lock update. This is a lifecycle-hook review, not a full third-party security audit.

Tests were read before execution. They operate on literal objects and disposable SQLite fixtures;
no private DB, external inference, historical command execution or service mutation is used.
CI runs on hosted Ubuntu with Node 24, pinned action SHAs, read-only contents permission,
checkout credential persistence disabled, no secrets, no artifact upload and a ten-minute timeout.
There are no `continue-on-error`, skipped or expected-failure regressions.
The initial workflow run was rejected before jobs started because `runner.temp` was used
at job-level `env`. It was moved to test-step `env`, where that context is available;
that workflow-validation failure must not be confused with the four test failures.

## Verified baseline and remaining gates

Local Node 24.22.2 / npm 11.19.1: exact-lock install and source native build succeed.
`npm --prefix telemetry test`: 33 tests / 29 pass / **4 actual failures**. The failures are named
in the telemetry README. This is not the full loose-directory suite and does not inherit its
prior passing counts. The public base has no telemetry package, so these are preserved incoming
Collector defects, not claimed regressions in existing public code.

Native GitNexus MCP listed only an index rooted at the loose Collector directory, with empty
commit and unknown freshness. No index covers this checkout/head. Graph impact/change analysis
is therefore **unavailable**, not passed. No CLI indexing or runtime restart was performed.
An authorized MCP-capable index workflow and exact-head graph review remain a gate.

Independent parent review must inspect the complete diff, privacy/provenance manifest and test
execution before accepting the draft. Human historical-data approval is separate and cannot
cure the four engineering defects. Keep the existing task blocked; do not create a duplicate
tracker. Merge, deploy, live collection, data publication and training are not authorized here.
