# Skill Knowledge Graph (`graph-db`)

> A SQLite-based knowledge graph that powers `resolve_skill` — the tool Gandalf uses to route tasks to the correct skill, script, API endpoint, or workflow before executing anything.

## Why This Exists

### The Problem: `<available_skills>` Prompt Bloat

OpenClaw ships with a skill system where installed skills get injected into the system prompt as an `<available_skills>` block. Each skill contributes its SKILL.md file contents — descriptions, instructions, gotchas, examples. With 20+ skills, this consumed **thousands of tokens every turn**, even when most skills were irrelevant.

Worse: Claude doesn't just read the block — it gets pulled into reasoning about skills it won't use, wasting compute on irrelevant context.

### The Solution: Dynamic Resolution

Instead of a fat static block in the prompt, we:

1. **Disabled all skill system prompts** in `openclaw.json` (`skills.entries.*.enabled: false`)
2. **Blocked bundled skills** (`skills.allowBundled: ["__none__"]`)
3. **Built a SQLite knowledge graph** with every skill, action, workflow, and their relationships
4. **Created `resolve_skill`** — an OpenClaw plugin tool that queries the graph at runtime
5. **Added telemetry** — every call is logged, misses are tracked, and a daily cron audits gaps

Now the agent gets one compact tool (`resolve_skill`) in its prompt instead of 20+ skill descriptions. It calls the tool only when it needs routing, and gets back just the relevant skill + attrs + action details.

**Token savings**: ~3,000-5,000 tokens/turn eliminated from the system prompt.

---

## Architecture

```
                    ┌─────────────────────────────────┐
                    │         Agent (Gandalf)          │
                    │                                  │
                    │  "check postiz queue"            │
                    └──────────┬──────────────────────┘
                               │ calls resolve_skill tool
                               ▼
                    ┌──────────────────────────────────┐
                    │   skill-resolver plugin           │
                    │   ~/.openclaw/extensions/         │
                    │       skill-resolver/index.js     │
                    │                                  │
                    │   Queries skillgraph.db               │
                    │   Logs to resolve-skill.jsonl    │
                    │   Returns structured JSON         │
                    └──────────┬──────────────────────┘
                               │ reads
                               ▼
                    ┌──────────────────────────────────┐
                    │         skillgraph.db (SQLite)         │
                    │                                  │
                    │   136 entities                    │
                    │   177 edges                       │
                    │   973 aliases                     │
                    │   255 attributes                  │
                    └──────────────────────────────────┘

Also available via CLI:

    graph-resolve "check postiz queue"
    → ~/bin/graph-resolve (bash wrapper)
    → projects/skillgraph/resolve.js (Node.js, same logic)
```

### Two Entry Points, Same Logic

| Entry Point | Where | When Used |
|---|---|---|
| `resolve_skill` tool | OpenClaw plugin (`~/.openclaw/extensions/skill-resolver/index.js`) | Agent calls it before executing tasks |
| `graph-resolve` CLI | `~/bin/graph-resolve` → `projects/skillgraph/resolve.js` | Tests, scripts, debugging |

Both query the same `skillgraph.db`. Both log to `~/clawd/logs/resolve-skill.jsonl`.

---

## Database Schema

Four tables. No foreign abstraction layers, no ORMs.

### `entities` — Nodes

```sql
CREATE TABLE entities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT NOT NULL,       -- workflow, skill, tool, stack, action, target, site, platform, api
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    emoji       TEXT,
    skill_path  TEXT,                -- DEPRECATED (kept for schema compat)
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);
```

**Entity types by count** (as of 2026-02-25):

| Type | Count | Purpose |
|---|---|---|
| `action` | 77 | Specific API endpoints/operations (e.g., `postiz-list-posts`, `komodo-deploy`) |
| `skill` | 25 | Top-level capabilities (e.g., `komodo`, `himalaya`, `postiz`) |
| `stack` | 12 | Docker stacks managed by Komodo |
| `tool` | 7 | External tools (Brave API, Scrapling, grepai) |
| `platform` | 4 | Social platforms (X, LinkedIn, Bluesky, Facebook) |
| `workflow` | 4 | Multi-step ordered processes (Blog Post, Social Media Post, Research, Image Generation) |
| `target` | 3 | Image format targets (blog-header, instagram-carousel, print) |
| `api` | 2 | External APIs (Wix API, Home Assistant API) |
| `site` | 2 | Websites (adultintraining.us, microdose-tracker.com) |

### `edges` — Relationships

```sql
CREATE TABLE edges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    target_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    relationship TEXT NOT NULL,      -- uses, requires, provides, manages, managed_by, publishes_to, etc.
    step_order  INTEGER,             -- for ordered workflows (1, 2, 3...)
    mandatory   INTEGER DEFAULT 0,   -- 1 = required step
    detail      TEXT,                -- freeform context
    UNIQUE(source_id, target_id, relationship)
);
```

Key relationships:
- `skill → action` via `provides` (e.g., `postiz` provides `postiz-list-posts`)
- `skill → stack` via `manages` / `managed_by` (e.g., `komodo` manages `ollama`)
- `workflow → skill` via `uses`, `requires`, `publishes_via` with `step_order`
- `stack → skill` via `managed_by` (reverse traversal for "start ollama" → komodo)

### `attrs` — Key-Value Properties

```sql
CREATE TABLE attrs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,
    UNIQUE(entity_id, key)
);
```

Common attr keys: `script`, `command`, `endpoint`, `method`, `body`, `prereq`, `port`, `gotcha`, `rule`, `env`.

### `aliases` — Natural Language Routing

```sql
CREATE TABLE aliases (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    alias       TEXT NOT NULL UNIQUE
);
```

**Aliases are the core of the routing system.** Every alias is a real phrase the user might say. Examples:
- `"check social media queue"` → `postiz-list-posts`
- `"what stacks are running"` → `komodo-list-stacks`
- `"transcribe this audio"` → `whisper-local`

The alias count (973) is intentionally high — more aliases = better natural language coverage.

---

## Resolution Algorithm

Implemented identically in both `resolve.js` (CLI) and `index.js` (plugin).

### Scoring Passes

| Pass | What | Score | Example |
|---|---|---|---|
| 1. Exact alias | Full query matches an alias | 100 | `"check my email"` → himalaya |
| 2. Multi-word phrase | Longest contiguous phrase match | 50 + (len × 10) | `"social media queue"` → postiz |
| 3. Bag-of-words overlap | Non-contiguous word overlap (≥2 words) | 35 + (overlap × 10) + bonus | `"create calendar event"` → caldav |
| 4. Single word | Individual word matches alias | 20 + type boost | `"email"` → himalaya |
| 5. Description fallback | Word appears in entity name/description | 10 | `"transcription"` → whisper-local |

### Tiebreakers

When scores are equal: `skill(6) > action(5) > tool(4) > workflow(3) > stack(2) > other(0)`

### Confidence Levels

| Score | Confidence |
|---|---|
| ≥ 50 | high |
| ≥ 20 | medium |
| < 20 | low |

### Action Drill-Down

When a **skill** entity wins, the resolver also finds the best-matching **child action** by:
1. Checking if any child action scored in the main scoring pool
2. Computing alias-word overlap between the query and each action's aliases
3. Picking the highest-scoring action and including its attrs (script, command, endpoint, prereq)

This means `"check social media queue"` resolves to **skill** `postiz` with **matched action** `postiz-list-posts` including its script attribute.

### Prereq Chain

If the matched action has a `prereq` attr (e.g., `postiz-list-posts` → `postiz-auth`), the resolver follows the chain and includes the prereq's attrs (login command, cookie jar path, etc.).

---

## File Inventory

### Core

| File | Purpose |
|---|---|
| `init-db.js` | Creates the schema (tables + indexes). Run once to set up. |
| `seed.js` | Seeds all entities, edges, attrs, aliases. **Authoritative source** — wipes and rebuilds. |
| `resolve.js` | CLI resolver. `node resolve.js "query"`. Logs to JSONL. |
| `query.js` | Rich query tool: `resolve`, `entity`, `workflow`, `list` subcommands. JSON output. |
| `test.js` | In-process test runner (87 test cases, same resolve logic). |
| `visualize.js` | Interactive D3.js force-directed graph viewer. `node visualize.js [port]`. |
| `skillgraph.db` | The SQLite database. WAL mode enabled for concurrent reads. |
| `package.json` | Dependencies: `better-sqlite3`. ESM (`"type": "module"`). |

### CLI Wrapper

| File | Purpose |
|---|---|
| `~/bin/graph-resolve` | Bash wrapper: runs `resolve.js` with the right `NODE_PATH`. |

```bash
#!/usr/bin/env bash
NODE_PATH=/home/coolmann/.openclaw/extensions/openclaw-plugin-continuity/node_modules \
  exec node /home/coolmann/clawd/projects/skillgraph/resolve.js "$@"
```

The `NODE_PATH` trick reuses `better-sqlite3` from the continuity plugin's `node_modules` instead of installing a second copy.

### OpenClaw Plugin (`resolve_skill` tool)

| File | Purpose |
|---|---|
| `~/.openclaw/extensions/skill-resolver/index.js` | The OpenClaw plugin. Registers `resolve_skill` as a tool. |
| `~/.openclaw/extensions/skill-resolver/openclaw.plugin.json` | Plugin manifest (id: `skill-resolver`). |
| `~/.openclaw/extensions/skill-resolver/package.json` | Dependencies: `better-sqlite3`. |

The plugin:
- Opens `skillgraph.db` read-only
- Runs the same scoring algorithm as `resolve.js`
- Returns structured JSON (not plain text) to the agent
- Logs every call to `~/clawd/logs/resolve-skill.jsonl`

### Telemetry Scripts

| File | Purpose |
|---|---|
| `scripts/graph-resolve-log.sh` | Wrapper that adds logging around `graph-resolve` CLI calls |
| `scripts/graph-resolve-miss.sh` | Log when the agent overrides a resolve result. Writes to `resolve-skill-misses.jsonl`. |
| `scripts/graph-resolve-review.sh` | Review miss log: groups by target, suggests alias fixes |
| `scripts/graph-optimize.sh` | **Daily cron (5:30 AM)**: runs test suite, analyzes misses, flags low-confidence resolves. Audit-only — does NOT auto-modify `skillgraph.db`. |
| `scripts/resolve-audit.sh` | Post-session audit: compares resolve recommendations vs actual execution |

### Test Suite

| File | Purpose |
|---|---|
| `tests/run-skillgraph-tests.sh` | Automated test runner: 70+ test cases across all skill areas |
| `tests/skillgraph-tests.md` | Human-readable test case documentation |
| `test.js` | In-process test runner (embedded in the project) |

### Log Files (all in `~/clawd/logs/`)

| File | What |
|---|---|
| `resolve-skill.jsonl` | Every `resolve_skill` call: query, result, confidence, score, matched action |
| `resolve-skill-misses.jsonl` | Every time the agent ignores the resolve result and uses something else |
| `graph-optimize.log` | Daily cron audit results |

---

## OpenClaw Configuration

### How Skills Were Disabled

In `~/.openclaw/openclaw.json`:

```json
{
  "skills": {
    "entries": {
      "komodo": { "enabled": false },
      "postiz": { "enabled": false },
      "wix-api": { "enabled": false },
      "whisper-local": { "enabled": false },
      // ... all skills set to enabled: false
    },
    "allowBundled": ["__none__"]
  }
}
```

Setting `enabled: false` on a skill entry prevents OpenClaw from injecting its SKILL.md into the system prompt as `<available_skills>`. The skill files still exist on disk — they're just not loaded into context.

`allowBundled: ["__none__"]` is a trick to block all of OpenClaw's built-in bundled skills from appearing.

### How the Plugin Is Registered

```json
{
  "plugins": {
    "allow": ["skill-resolver"],
    "entries": {
      "skill-resolver": {
        "enabled": true,
        "config": {
          "graphPath": "skills/GRAPH.md"
        }
      }
    }
  }
}
```

The `graphPath` config is vestigial (from when the plugin read GRAPH.md). The plugin now reads `skillgraph.db` directly via a hardcoded path. The config remains for schema compat but isn't used.

The plugin is auto-discovered from `~/.openclaw/extensions/skill-resolver/` because it has a valid `openclaw.plugin.json` manifest.

### Agent Rule Enforcement

In `AGENTS.md`, the mandatory rule:

```markdown
## Task Routing (MANDATORY)
Before executing ANY task: use the `resolve_skill` tool.
1. Call: `resolve_skill("<task description>")`
2. Follow the skill's returned instructions — no SKILL.md read needed
3. If no match → proceed with best judgment

**No exceptions.**
```

This rule is in the workspace context that gets injected every turn. It costs ~50 tokens vs ~3,000+ for the old `<available_skills>` block.

---

## How to Rebuild From Scratch

### 1. Set up the project

```bash
cd ~/clawd/projects/skillgraph
npm install    # installs better-sqlite3
node init-db.js   # creates schema
node seed.js      # populates all data
```

### 2. Install the CLI wrapper

```bash
cat > ~/bin/graph-resolve << 'EOF'
#!/usr/bin/env bash
NODE_PATH=/home/coolmann/.openclaw/extensions/openclaw-plugin-continuity/node_modules \
  exec node /home/coolmann/clawd/projects/skillgraph/resolve.js "$@"
EOF
chmod +x ~/bin/graph-resolve
```

Ensure `~/bin` is in `$PATH`.

### 3. Install the OpenClaw plugin

```bash
mkdir -p ~/.openclaw/extensions/skill-resolver
cp index.js package.json openclaw.plugin.json ~/.openclaw/extensions/skill-resolver/
# (The plugin's index.js is in this repo for reference, but the live copy is in extensions/)
cd ~/.openclaw/extensions/skill-resolver
npm install
```

### 4. Configure openclaw.json

Follow **GP-004** (the 7-step edit protocol in TOOLS.md):

a. Disable all skill system prompts:
```json
"skills": {
  "entries": {
    "komodo": { "enabled": false },
    "postiz": { "enabled": false }
    // ... etc for every installed skill
  },
  "allowBundled": ["__none__"]
}
```

b. Enable the plugin:
```json
"plugins": {
  "allow": ["skill-resolver"],
  "entries": {
    "skill-resolver": {
      "enabled": true
    }
  }
}
```

c. Validate and restart:
```bash
python3 -c "import json; json.load(open('/home/coolmann/.openclaw/openclaw.json')); print('valid')"
openclaw gateway restart
```

### 5. Set up the daily cron

```bash
# Add to crontab
30 5 * * * /home/coolmann/clawd/projects/skillgraph/scripts/graph-optimize.sh --days 1
```

### 6. Run the test suite

```bash
bash ~/clawd/projects/skillgraph/tests/run-skillgraph-tests.sh
# Target: >90% pass rate
```

### 7. Verify it works

```bash
# CLI
graph-resolve "check postiz queue"
# Should return: SCRIPT + SKILL + CONFIDENCE + ATTRS

# Plugin (in agent conversation)
# Ask: "resolve_skill('check postiz queue')"
# Should return structured JSON with skill, matchedAction, actionAttrs
```

---

## Adding New Skills / Actions

### Adding a new skill to the graph

Edit `seed.js`:

```javascript
// 1. Create the entity
ensureEntity({ type: 'skill', name: 'my-new-skill', description: 'What it does', emoji: '🔧' });

// 2. Add natural-language aliases (what the user would actually say)
addAlias('my-new-skill',
    'do the thing', 'run the thing', 'thing status',
    'check my thing', 'new thing'
);

// 3. Add attributes (config, gotchas, rules)
addAttr('my-new-skill', 'port', '8080');
addAttr('my-new-skill', 'gotcha', 'Must restart after config change');

// 4. Add actions (specific operations)
ensureEntity({ type: 'action', name: 'my-skill-status', description: 'Check status', emoji: null });
addAttr('my-skill-status', 'script', 'bash ~/clawd/scripts/my-skill-status.sh');
addAttr('my-skill-status', 'command', 'curl -s http://localhost:8080/status');
addAlias('my-skill-status', 'check thing status', 'thing running');

// 5. Wire skill → action edge
addEdge('my-new-skill', 'my-skill-status', 'provides', { detail: 'GET /status' });
```

Then re-seed:
```bash
node seed.js
```

### Adding test cases

Add to `tests/run-skillgraph-tests.sh`:
```bash
"T1|check thing status|my-new-skill|my-skill-status"
```

And to `tests/skillgraph-tests.md` for documentation.

### GP-003: Mandatory after changes

Per AGENTS.md gating policy GP-003, after any skill graph change:
1. Re-seed: `node seed.js`
2. Run tests: `bash tests/run-skillgraph-tests.sh`
3. Verify >90% pass rate
4. Log the change in daily notes

---

## Self-Healing Telemetry Loop

```
Agent uses resolve_skill → logs to resolve-skill.jsonl
                              │
                              ▼
Agent overrides result → logs to resolve-skill-misses.jsonl
                              │
                              ▼
Daily cron (graph-optimize.sh) at 5:30 AM
  ├── Runs test suite → reports pass rate
  ├── Analyzes misses → suggests new aliases
  ├── Flags low-confidence resolves → suggests improvements
  └── Outputs to graph-optimize.log
                              │
                              ▼
Next session: Gandalf reviews audit results
  ├── Adds missing aliases to seed.js
  ├── Re-seeds skillgraph.db
  ├── Adds new test cases
  └── Verifies >90% pass rate
```

The system is **audit-only** — the cron never auto-modifies `skillgraph.db`. All changes go through `seed.js` during a session, reviewed by the agent and/or human.

---

## Visualizer

```bash
node visualize.js 8099
# Open http://localhost:8099
```

Interactive D3.js force-directed graph:
- Color-coded by entity type
- Filter by type, search by name/alias
- Click nodes to see attrs, aliases, edges
- Drag nodes, zoom/pan

---

## Key Design Decisions

1. **Use-case-first aliases** — Every alias is a real phrase someone would say, not an abstract category. "check social media queue" not "social-media-list".

2. **Seed is authoritative** — `seed.js` wipes and rebuilds. The DB is derived state. If you need to change something, change `seed.js` and re-seed.

3. **No vector search (yet)** — Pure string matching with multi-pass scoring. Fast, deterministic, debuggable. Vector/embedding layer deferred until string matching hits its limits.

4. **Actions carry the details** — Skills are routing targets. Actions carry the actual commands, endpoints, scripts, prereqs. The resolver drills down from skill to best-matching action automatically.

5. **Logging never breaks resolution** — All logging is wrapped in try/catch. If the log file is unwritable, the resolve still returns.

6. **Shared native module** — Both the plugin and CLI reuse `better-sqlite3` from the continuity plugin's node_modules to avoid double-installing native binaries.

---

## Development History

- **2026-02-24**: Initial build. Schema design, seed.js with 90 entities, 310 aliases. Test suite (44 cases). resolve.js + query.js. Baseline: 56% strict pass.
- **2026-02-24**: Added action entities, prereq chains, bag-of-words scoring, tiebreakers. 210+ new aliases. DB grew to 90 entities, 670 aliases.
- **2026-02-24**: Built self-healing loop: graph-resolve-log.sh, graph-resolve-miss.sh, graph-resolve-review.sh, graph-optimize.sh (daily cron). Created resolve_skill OpenClaw plugin.
- **2026-02-24**: Added auto-logging to both resolve.js and plugin index.js. Built resolve-audit.sh.
- **2026-02-25**: Continued alias additions, test case expansion (70+ cases). DB at 136 entities, 973 aliases.
- **2026-02-25**: Disabled `<available_skills>` in openclaw.json. Full cutover to graph-based routing.
