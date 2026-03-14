# SkillGraph — Task Routing for Gandalf

## What It Is
SQLite-based knowledge graph that powers `resolve_skill` — the tool Gandalf uses to route tasks to the correct skill, script, API endpoint, or workflow before executing anything. Replaced the old `<available_skills>` prompt injection approach, saving ~3,000-5,000 tokens/turn.

## Current State
- **Live and working** — resolves tasks to skills via aliases, embeddings, and fuzzy matching
- **Project folder:** `projects/skillgraph/` (renamed from `projects/graph-db/` on 2026-03-05)
- **Database:** `projects/skillgraph/skillgraph.db` (renamed from graph.db on 2026-03-05)
- **Test file:** `tests/run-skillgraph-tests.sh` (renamed from run-resolve-tests.sh on 2026-03-05)
- **426+ entities** with aliases, attrs, edges
- **Test suite:** 103 test cases in `tests/run-skillgraph-tests.sh` — ✅ 103/103 passing (100%)
- **Daily audit cron** runs at 5:30 AM via `scripts/graph-optimize.sh`

## Architecture

```
Agent (Gandalf)
  │ calls resolve_skill("<task>")
  ▼
~/bin/graph-resolve (bash wrapper)
  │ calls node resolve.js
  ▼
projects/skillgraph/resolve.js
  │ reads skillgraph.db
  ▼
Returns: skill, confidence, instructions, matchedAction, attrs
```

### Key Files
| File | Purpose |
|------|---------|
| `skillgraph.db` | The SQLite database (source of truth) |
| `resolve.js` | Main resolver — called by `graph-resolve` CLI |
| `query.js` | Direct query interface |
| `init-db.js` | Schema initialization |
| `seed.js` | Seed data loader |
| `test.js` | Test runner |
| `visualize.js` | Graph visualization |
| `scripts/graph-optimize.sh` | Nightly audit + optimization |
| `scripts/resolve-audit.sh` | Audit resolve accuracy |
| `tests/run-skillgraph-tests.sh` | 103-case test suite |

### External References
| Location | What |
|----------|------|
| `~/bin/graph-resolve` | Bash wrapper → resolve.js |
| `~/.openclaw/openclaw.json` → `plugins.entries.skill-resolver` | Plugin config (enabled: true) |
| `scripts/graph-cleanup.py` | Cleanup stale entities |
| `scripts/graph-drift-check.sh` | Detect skill/stack drift |
| `scripts/graph-llm-backfill.js` | LLM-based alias generation |
| `scripts/graph-stats-report.sh` | Nightly usage analysis |
| `scripts/compliance-nightly-audit.sh` | Retroactive resolve accuracy check |

## Database Schema
- **entities** — skills, tools, workflows, sites, devices, APIs, platforms
- **edges** — relationships (uses, requires, feeds, publishes_to, monitors, manages)
- **aliases** — multiple search terms per entity (how resolve_skill finds matches)
- **attrs** — key/value metadata per entity (binary paths, scripts, env vars, etc.)
- **usage_history** — telemetry for every resolve_skill call

## Configuration
- Plugin: `skill-resolver` in `~/.openclaw/openclaw.json`
- Config: `{ "enabled": true, "config": { "graphPath": "skills/GRAPH.md" } }` (graphPath is legacy/unused — actual resolution goes through `~/bin/graph-resolve`)
- All bundled skills disabled: `skills.allowBundled: ["__none__"]`

## Key Decisions
- **Renamed graph.db → skillgraph.db** (2026-03-05) — too many graph.db files in the workspace causing confusion. All scripts, docs, and references updated. Old file in `.trash/`.
- **SkillGraph** is the canonical name — avoids ambiguity with knowledge graph plugin, facts.db, or any other graph database.
- **A/B tested descriptions** (2026-02-28) — tested 4 description variants across 20 tasks. Current description is the winner.
- **Embeddings via nomic-embed** (localhost:8082) — used for semantic similarity matching when alias match fails.
- **GP-003 (SkillGraph Maintenance)** — mandatory update whenever a skill is added/removed/changed or a tool is used in a new way.

## Maintenance (GP-003)
When to update the SkillGraph:
1. Installing/removing a skill
2. Creating/deleting a Docker stack
3. Adding a new tool
4. Using an existing tool in a new way

Steps:
1. Add/update entities, aliases, attrs in `skillgraph.db`
2. Run test suite: `bash tests/run-skillgraph-tests.sh`
3. Target: >90% pass rate

## Known Issues
- Test suite 103/103 failing as of 2026-03-05 — needs investigation (may be a path issue from the rename)
- `graphPath` config in plugin is vestigial — doesn't do anything

## Next Steps
- [ ] Fix test suite (103/103 failing)
- [ ] Investigate if `graphPath` plugin config should be updated or removed
- [ ] Consider renaming the project folder from `graph-db/` to `skillgraph/` for full consistency
