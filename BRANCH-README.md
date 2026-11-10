# Branch handoff: audited Collector SDLC

- Repository: https://github.com/coolmanns/skillgraph (public).
- Branch: `chore/collector-audited-sdlc`.
- Base: `0090e4b16f82717816b78c1f74f62e214619a0fa` (`main` at clone time).
- Isolated checkout: `projects/skillgraph-sdlc-collector` under the operator's home.
- Exact candidate head: read `git rev-parse HEAD` and compare the PR's `headRefOid`;
  do not treat a self-referential documentation hash as current review evidence.

## Purpose and preservation boundary

Establish reviewable code history, reproducible synthetic checks and an honest draft PR for
an audited subset of the previously loose Collector. Neither original source directory was
edited. No dirty legacy runtime changes, databases, private history or historical labels are
implicitly accepted. See the [audit and exclusions](docs/COLLECTOR-MIGRATION.md) and
[per-file provenance manifest](docs/collector-migration-manifest.json).

The source import is followed by an explicit acceptance-regression commit and SDLC documentation/
CI commit. This is a migration, not broad product remediation. Do not use this branch for
unrelated runtime repairs. Start subsequent work from the reviewed base/head on a new task branch,
carry the regression gates forward, and keep one writer per checkout.

## Reviewer/operator workflow

1. Inspect the full base-to-head diff and manifest; independently confirm no historical payload.
2. Install using the audited commands in `telemetry/README.md`; run the **default** full test gate.
3. Confirm the four named failures, not just a count; positive controls must pass.
4. Read exact-head GitHub checks and independent review separately. Self-review is not approval.
5. Resolve the missing new-checkout GitNexus index via an authorized native MCP workflow.
6. Keep the existing Collector task blocked. Parent owns its state and evidence handoff.

Local migration baseline: **33 tests, 29 pass / 4 fail**. Missing index, independent review and
engineering fixes are open gates. No historical corpus readiness, calibration or deployment
claim is made. A green diagnostic subset is insufficient.

## Authority, rollback and definition of done

User authorized audited code publication, this isolated branch and a **draft** PR only.
No merge, deployment, config change, restart, activation or historical-data publication.
Rollback for this migration is to decline/close the draft; no live runtime changes need reversal.
Before eventual merge: independent acceptance of scope/privacy, reviewed fixes for failing
regressions, full exact-head CI and resolution of code-index/review requirements. Separate
approval is required for any deployment, pilot or data handling beyond this synthetic scope.
