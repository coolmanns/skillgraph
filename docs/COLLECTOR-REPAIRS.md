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

First repair checkpoint result: **108 tests / 108 pass / 0 fail / 0 skipped / 0 todo**.
This checkpoint was subsequently rejected by independent review (R1/R2); see corrections below. The original canvas
migration boxes checked whitespace only; separate repair boxes use real test commands.
Sanitized RED/GREEN logs `00-baseline.log` through `18-final-full.log` are preserved locally in
`collector-review-handoff/repair-pass-evidence` under the operator's Hermes workspace, not
published as historical data. The final sanitized log SHA-256 is
`f1a2de9b797dcb3c87ac41bba65e3e576ffb6245ded5ea9b8aaad5d27263a220`.

## Independent-review corrections (R1/R2)

Correction baseline: `2322e1fd2bddc27ed500b1ce99d044cbb7d9bcbf`. The independent review
requested changes despite 108 passing repository tests: its original adversarial suite had
**15 tests / 13 pass / 2 fail**. The original executable remains unchanged and is rerun locally;
its SHA-256 is `6b18784159ad5dd4afe42af60da1ac96ba2c996891ad43717d170bb7161903aa`.

- **R1:** omitted `mode` now means `replace`, matching Hermes `tools/file_tools.py`:
  `patch_tool(mode="replace")` and registered handler `args.get("mode", "replace")`.
  Replace mode requires path and replacement strings. Payload presence cannot imply patch mode.
  The old patch-only/default equivalence assertion encoded the wrong producer contract; replacing
  it with explicit negative controls corrects that contract, not weakens the gate. Explicit patch
  payloads and aliases remain groupable, and explicit/default replacement equivalence is retained.
  The full suite exposed a second old fixture in `classifiers.test.js` that omitted patch mode;
  its payload-distinction control now uses explicit mode and also asserts nonempty signatures.
- **R2:** compare the signed integer coefficient to the exact Date limit scaled by its decimal
  precision, before rendering or Number conversion. Both endpoints are inclusive; arbitrarily
  close supported fractions beyond them reject. Seconds/milliseconds threshold, exponent limits,
  modern window/profile filtering before bodies and LIMIT, and approximate coverage metadata
  are unchanged. New matrix covers signed endpoints, interior neighbors, fractions and exponents.

| Gate | Command | RED | GREEN |
| --- | --- | --- | --- |
| R1 | `node --test --test-reporter=tap telemetry/tests/patch-retries.test.js` | 21 pass / 2 fail | 23 pass |
| R2 | `node --test --test-reporter=tap telemetry/tests/hermes-time-range.test.js` | 15 pass / 8 fail | 23 pass |
| Original reviewer adversarial suite (local, immutable) | `node --test --test-reporter=tap <reviewer-suite>` | 13 pass / 2 fail | 15 pass |
| Default full gate | `npm --prefix telemetry test` | 132 pass / 1 obsolete mode-fixture failure after R1/R2 | 133 pass |

All GREEN runs have zero failures, skips or todos. The full gate expanded from 108 by two R1
cases and 23 R2 cases; no test was removed. The fixture correction after the full run is
supplemental contract coverage, not retroactive RED evidence. Synthetic-only logs are retained
under the operator's Hermes workspace in `collector-review-handoff/review-corrections-evidence/`.
Early harness runs used a different Node binary and hit a native SQLite ABI mismatch; those logs
are retained, not counted as product RED. Authoritative runs pin `/usr/bin/node` (v24.22.2) and
put `/usr/bin` first for npm; existing dependencies/native artifacts were not changed.
Exact final candidate, CI URLs and refreshed index identity are recorded in the draft PR and
local handoff after commit, avoiding a self-referential hash in tracked docs.

## R3: same-native-ID payload conflicts (repaired; review corrections applied)

**Defect (pre-existing, retained through R1/R2).** Two fully observed patch representations with
the same session/native ID, same path/mode but different `new_string` values had distinct classifier
signatures yet yielded **1 reduced / 0 quarantined**: `chooseRichestCall` silently kept one, because
the reducer compared only target and action. Before the fix it was an expected-red open acceptance
gate in its own CI job (`7ede2fd`: 2 controls pass, the R3 case fails; regression job unchanged).

**Rule.** Representations of one native call must agree on every field they share; otherwise
`operation_payload` is added to the `material_variant_conflict` quarantine instead of choosing a
variant. All tools. Each representation maps every canonical field to the list of values it carries
under any documented alias (`path`/`file_path`, `old_string`/`old_text`/`oldText`,
`new_string`/`new_text`/`newText`, `patch`/`diff`, `content`/`data`, skill `name`/`skill_name`/`skill`,
…; aliases resolved for the classifier-normalized tool name, so `Patch` → `patch`). For every field
both representations carry, all values from both sides must agree pairwise. Consequently:

- the outcome does not depend on which alias spelling either side uses;
- a representation whose own aliases disagree conflicts with any partner carrying that field, and
  duplicates of such a self-contradictory representation also quarantine (fail closed);
- a truncated alias value cannot hide a disagreement between full values.

Values compare as follows: a field present on only one side is a compaction omission (allowed); a
string ending in the known `...[truncated]` marker is a compaction variant compatible with any value
(allowed); arrays compare element by element, so a truncated element exempts only itself and any
length difference is a conflict (the marker proves a string was cut, not that an array lost
elements); everything else compares canonically and exactly, including Unicode form, whitespace and
case. The only normalizations are those the older checks already apply, on those top-level fields:
skill names on `skill_*` tools after NFC + trim, and `action`/`operation`/`mode` after NFC + trim +
lowercase (all three, where the older check uses the first present). Complete representations are
also compared after the classifier's default normalization (`operationStableFields`), so an implicit
`replace_all: false` contradicts an explicit `true`; a `null` there only means the field was absent
and is dropped (an explicit `null` in the retained arguments is still a value). Values cut without
the marker fail closed.

**TDD evidence.** `telemetry/tests/r3-duplicate-native-id-conflict.test.mjs` (part of `npm test`;
the `open-gates` job and `test:open-gates` script were removed with it):

| Step | Result |
|---|---|
| Open gate at `7ede2fd` (CI) | 2 pass / 1 fail (R3 assertion only) |
| First suite before the fix (RED) | 12 tests: 5 controls + 1 immutability test pass, 6 conflict cases fail |
| First fix `98e3bf3` (GREEN) | 12 / 12; full gate 145 / 145 |
| Independent review of `98e3bf3` | request changes: alias on an incomplete representation and one truncated element exempting a whole array were missed; byte-exact comparison was stricter than the older checks |
| Review tests against the `98e3bf3` reducer (RED) | 18 tests: 15 pass, 3 fail (exactly the three review tests) |
| Corrections `fdcfe87` (GREEN) | 18 / 18; full gate 151 / 151 |
| Re-review of `fdcfe87` | request changes: self-disagreeing aliases on one representation hid a same-key conflict (regression vs `98e3bf3`); aliases looked up by raw tool name; NFC applied more widely than the older checks |
| Re-review tests against the `fdcfe87` reducer (RED) | 21 tests: 18 pass, 3 fail (exactly the three re-review tests) |
| Re-review corrections `e002f26` (GREEN) | 21 / 21; full gate 154 / 154 |
| Round-3 review of `e002f26` | request changes: a self-disagreeing alias set could still hide a conflict depending on the partner's alias spelling or a truncated alias; docs still cited a figure from the unauthorized read |
| Round-3 tests against the `e002f26` reducer (RED) | 24 tests: 22 pass, 2 fail (exactly the two defect tests; controls pass) |
| Per-field value lists `d0d754a` (GREEN) | 25 / 25 (incl. pinned fail-closed duplicate case); full gate 158 / 158 |
| Round-4 review of `d0d754a` | request changes (low, fail-closed, present since `98e3bf3`): a patch-mode representation without `path` falsely conflicted via the stable form's `path: null` |
| Round-4 tests against the `d0d754a` reducer (RED) | 27 tests: 26 pass, 1 fail (the round-4 control) |
| Null stable fields dropped (GREEN) | 27 / 27; full gate `npm --prefix telemetry test` 160 / 160, 0 skipped/todo |
| Unchanged independent adversarial suite (2322e1fd reviewer) | 15 / 15 |
| Unchanged reviewer extra probes (8e0550de rereview) | 4 / 4 |

The reviewers' own probe sets, rerun unchanged against each correction, flip exactly the reported
cases (round 1: 3 normalization cases reduce, 2 alias and 3 array false negatives quarantine;
round 2: 4 self-alias cases and 3 NFC-outside-normalized-field cases quarantine, mixed-case tool
names resolve; round 3: all 8 reported alias-spelling and truncated-alias cases quarantine; round 4: both
patch-mode omitted-path cases reduce) and leave every benign-compaction case reducing.

**Limits and follow-ups (not fixed here).**
- A patch representation with no `mode` and a `patch` payload versus an explicit `mode: patch` with
  the same payload reduces: a missing field is treated as an omission, and Hermes defaults an omitted
  mode to `replace`. Whether real compaction drops keys at all is unverified.
- Only the legacy `...[truncated]` marker is recognized; the newer Hermes context-compressor marker
  is treated as a conflict (fail closed).
- Pre-existing: arguments nested ~2000+ levels can throw `RangeError` and abort the whole reduction
  (base and head); `parseJsonObject` throws on objects containing `1e999`. A depth cap belongs in a
  separate change.
- During review round 1 the reviewer read local history (`~/.hermes/state.db`) outside its brief and
  before the card's retention check. Nothing from that read is used as evidence here; later rounds
  were barred from real-history access.
- Synthetic evidence. The parent owns rereview; green CI does not make the product ready, close the
  task, or authorize merge/deployment.

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
