# Collector scoped correctness repair

Status: implemented and synthetic-tested; **draft, independent review pending**. No merge,
deployment, live collection, private-history access or historical-label publication occurred.
The existing Collector task remains blocked under its parent's ownership. This is not the full
Collector migration or corpus-readiness project.

## Baseline and provenance

Repair baseline: `92bcf38624aabdb7790a075297e31dbb3816108b` on
`chore/collector-audited-sdlc`; public PR: https://github.com/coolmanns/skillgraph/pull/1.
The original 30 migration destination hashes were checked against that Git revision. The
manifest's original `files` records are unchanged; `repair_passes` appends current source/test
hashes and identifies newly authored files. No original source checkout or corpus was modified.

The prior scratch boundary proposal was inspected, not applied. Its three original source/test
baseline hashes match the imported baseline, but its proposed test fixture uses an old source
identifier rather than this checkout's synthetic one. The new implementation keeps the necessary
exact-decimal comparison idea but uses a separate bounded helper, validates calendar dates,
omits invalid source times instead of throwing during discovery, supports exact fractional
boundaries, and enforces profile membership for date-only scopes too. The new helper is included
in the adapter build hash. Proposed GREEN logs were not treated as accepted evidence.

## Repairs and limits

1. Empty acceptance lists cannot carry `verified_success`.
2. Every success predicate must be `supported` and reference non-claim evidence whose source,
   session, profile, timestamp and role pass the existing checks. Partial/unknown reviews retain
   their honest semantics. This validates support structure, **not** receipt truth, relevance,
   skill fit or an exhaustive acceptance list. See the allowed evidence kinds in telemetry README.
3. Source time filtering uses exact decimal arithmetic before bodies, including mixed seconds,
   milliseconds, numeric text, zoned ISO and sub-millisecond values. SQL no longer uses lossy
   Julian-day conversion. Rounded event presentation timestamps cannot discard eligible rows.
   Invalid source times are omitted by date filters; invalid bounds throw. A real SQLite view
   sentinel verifies excluded bodies are not evaluated on selected extraction.
4. Bounded and date-scoped extraction rejects missing profile membership and excludes NULL/other
   profiles. Only the explicitly documented all-null legacy unbounded API remains profile-unverified.
5. Patch retry identity contains the literal edit payload, mode and replace-all intent, normalizes
   equivalent defaults/aliases, and rejects malformed/ambiguous/truncated/unknown fields for grouping.
   Coarse path signatures remain analytics-only. Synthetic extraction/replay verifies equivalent
   retries, distinct edits and per-call fallback, without modifying source bytes.

Derived event/build hashes and patch retry keys can change on re-extraction. Do not rewrite old
observations or mix new derived output into a frozen historical bundle. No historical re-extraction
was performed. Timestamp text is bounded to 128 characters with exponent/scale limits; numeric
storage precision already lost cannot be recovered. Event and coverage display times remain
approximate. This is not a new complete timestamp/patch language or a semantic evaluator.

## Executed TDD evidence

Node `v24.22.2`; installed dependencies verified: better-sqlite3 `12.11.1`, ajv `8.20.0`,
ajv-formats `3.0.1`. Existing exact-lock dependencies/native build were reused; no dependency or
CI policy changes were needed. All fixture databases are synthetic and temporary.

| Slice | Command (from repo root) | RED | GREEN |
| --- | --- | --- | --- |
| Empty success | `node --test --test-name-pattern='verified success requires acceptance' telemetry/tests/parent-acceptance.test.mjs` | 0 pass / 1 fail | 1 pass |
| Predicate support | `node --test telemetry/tests/parent-acceptance.test.mjs` | 9 pass / 5 fail | 14 pass |
| Profile scope | `node --test --test-name-pattern='profile\|legacy' telemetry/tests/parent-boundaries.test.mjs` | 1 pass / 2 fail | 3 pass |
| Exact time | `node --test telemetry/tests/parent-boundaries.test.mjs` | 29 pass / 16 fail | 45 pass (46 including collector-bounds control) |
| Patch content | `node --test telemetry/tests/patch-retries.test.js` | 0 pass / 1 fail | 1 pass |
| Patch conservatism | same patch command | 3 pass / 17 fail | 21 pass after adding extraction/replay control |

RED failures were missing expected specific exceptions, boundary row/status mismatches, or equal
retry signatures—not fixture/type/import errors. Positive controls ran. Each production slice
followed its failing regression; full-suite checkpoints retained the still-unfixed defects:
`29/33 → 30/33 → 41/43 → 44/45 → 85/85 → 86/86 → 108/108` (passing/total).
Later body-sentinel and malformed-boundary checks are supplemental coverage, not retroactive RED
claims. No skips, todos, expected-failure wrappers or `continue-on-error` were added.

Final local commands:

```sh
node --test telemetry/tests/parent-acceptance.test.mjs
node --test telemetry/tests/parent-boundaries.test.mjs telemetry/tests/collector-bounds.test.js
node --test telemetry/tests/patch-retries.test.js
npm --prefix telemetry test
git diff --check
```

Final full result: **108 tests / 108 pass / 0 fail / 0 skipped / 0 todo**. The original canvas
migration boxes checked whitespace only; separate repair boxes use real test commands.
Sanitized RED/GREEN logs `00-baseline.log` through `18-final-full.log` are preserved locally in
`collector-review-handoff/repair-pass-evidence` under the operator's Hermes workspace, not
published as historical data. The final sanitized log SHA-256 is
`f1a2de9b797dcb3c87ac41bba65e3e576ffb6245ded5ea9b8aaad5d27263a220`.

## GitNexus and external gates

The user approved a narrow CLI exception solely to index this isolated public checkout. The
configured MCP entrypoint and writer were verified identical; version `1.6.12`, `analyze --help`,
existing ignore rules, `--index-only --name skillgraph-collector-sdlc --workers 2`. No embeddings,
network source transfer, generated agent instructions, shared-backend restart or reconnect.
Baseline index: exact repair-baseline SHA, 57 files / 850 nodes / 2,105 edges / 64 flows;
zero indexed files in the checked excluded data/runtime/dependency roots.

Native MCP query/context/upstream impact resolved validation, selection and classification paths
without partial-search warnings. `classifyOperation` impact was HIGH (reducer, duplicate-conflict
handling, extraction); both direct callers were inspected and replay was exercised. Other changed
entry-point impacts were LOW. Static graph evidence is not exhaustive runtime proof. Final
stable-head refresh, representative native MCP queries and base-to-head `detect_changes`, followed
by exact-SHA CI/review readback, belong in the PR handoff rather than a self-referential commit hash
in this document. If a cached MCP handle blocks refresh verification, report it without restarting
the shared backend.

Independent parent review is still required. Broader CLI/store/Python/OpenClaw migration,
specialist profiles, historical semantic review, training/calibration and deployment remain
outside this repair. The initial migration's failed CI and Node-action deprecation notices remain
historical evidence, not a claim that the new candidate has failed. Read exact-head jobs separately.
