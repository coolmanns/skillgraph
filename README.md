# SkillGraph

> A SQLite-based knowledge graph that replaces static `<available_skills>` prompt injection with dynamic, on-demand skill resolution for [OpenClaw](https://github.com/openclaw/openclaw) agents.

## The Problem

OpenClaw's default skill system injects every installed skill's `SKILL.md` into the system prompt as an `<available_skills>` block. With 20+ skills, that's **3,000–5,000 tokens per turn** — most of it irrelevant to the current task. The agent wastes compute reasoning about skills it won't use.

## The Solution

SkillGraph replaces the static block with a single tool call:

```
Agent: "I need to check the social media queue"
       → calls resolve_skill("check social media queue")
       → gets back: { skill: "postiz", action: "postiz-list-posts", script: "..." }
       → executes the right command
```

One tool registration (~50 tokens) instead of 20+ skill descriptions (~4,000 tokens). The agent calls `resolve_skill` only when it needs routing.

## How It Works

```
┌──────────────────────┐
│   Agent calls         │
│   resolve_skill()     │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐     ┌──────────────────────┐
│  skill-resolver       │────▶│     skillgraph.db     │
│  (OpenClaw plugin)    │     │                      │
│                      │     │  entities (skills,    │
│  Multi-pass scoring   │     │   actions, tools,    │
│  + vector fallback    │     │   workflows, stacks) │
│  + telemetry logging  │     │  aliases (973+)      │
│                      │     │  attrs (scripts,     │
│  Returns structured   │     │   endpoints, gotchas)│
│  JSON to agent        │     │  edges (provides,    │
└──────────────────────┘     │   requires, manages) │
                             └──────────────────────┘
```

### Resolution Algorithm

Five scoring passes, from most to least specific:

| Pass | Strategy | Score | Example |
|------|----------|-------|---------|
| 1 | Exact alias match | 100 | `"check my email"` → himalaya |
| 2 | Multi-word phrase | 50 + len×10 | `"social media queue"` → postiz |
| 3 | Bag-of-words overlap | 35 + overlap×10 | `"create calendar event"` → caldav |
| 4 | Single word match | 20 + type boost | `"email"` → himalaya |
| 5 | Description fallback | 10 | `"transcription"` → whisper |

When alias scoring is low-confidence, an optional **vector fallback** queries a local embedding model (e.g., nomic-embed-text) against pre-computed entity embeddings for semantic matching.

**Tiebreakers:** `skill(6) > action(5) > tool(4) > workflow(3) > stack(2) > other(0)`

### Action Drill-Down

When a **skill** entity wins, the resolver also finds the best-matching **child action** and returns its attributes (script, command, endpoint, prereqs). So `"check social media queue"` returns both the skill (`postiz`) and the specific action (`postiz-list-posts`) with its executable script.

## Database Schema

Four tables in SQLite (WAL mode):

- **`entities`** — Nodes: skills, actions, tools, workflows, stacks, platforms, APIs, sites
- **`aliases`** — Natural language phrases that route to entities (the core of the system)
- **`attrs`** — Key-value properties: `script`, `command`, `endpoint`, `prereq`, `gotcha`, `port`, `env`
- **`edges`** — Relationships: `provides`, `requires`, `manages`, `managed_by`, `publishes_to` (with optional `step_order` for workflows)

`seed.js` is the **single source of truth** — it wipes and rebuilds the database. The `.db` file is derived state.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Initialize and seed the database

```bash
node init-db.js    # create schema
node seed.js       # populate entities, aliases, attrs, edges
```

### 3. Test the CLI resolver

```bash
node resolve.js "check social media queue"
# → SCRIPT: ...
# → SKILL: postiz
# → ENTITY: postiz-list-posts (action)
# → CONFIDENCE: high (score 80)
```

### 4. Install as an OpenClaw plugin (optional)

The `skill-resolver` plugin wraps `resolve.js` as an OpenClaw tool. See [Plugin Setup](#plugin-setup) below.

## CLI Usage

```bash
# Resolve a task to a skill
node resolve.js "deploy the blog"

# Query the graph directly
node query.js resolve "check ollama"
node query.js entity postiz
node query.js workflow "blog post"
node query.js list skills

# Visualize the graph (opens a D3.js force-directed viewer)
node visualize.js 8099
```

## Plugin Setup

To use SkillGraph as an OpenClaw `resolve_skill` tool:

1. Create the plugin directory:
```bash
mkdir -p ~/.openclaw/extensions/skill-resolver
```

2. Create a plugin that imports `resolve.js`:
```javascript
// index.js — thin wrapper
const { resolve } = await import("/path/to/skillgraph/resolve.js");
```

3. Register it in `openclaw.json`:
```json
{
  "plugins": {
    "allow": ["skill-resolver"],
    "entries": {
      "skill-resolver": { "enabled": true }
    }
  }
}
```

4. Disable static skill injection:
```json
{
  "skills": {
    "allowBundled": ["__none__"],
    "entries": {
      "komodo": { "enabled": false }
    }
  }
}
```

The plugin adds:
- **Vector fallback** — semantic matching when alias scoring misses
- **Usage history boost** — recently-used skills get a confidence bump
- **Structured JSON** — returns machine-readable results to the agent
- **Telemetry logging** — every call logged to `resolve-skill.jsonl`

## Adding Skills

Edit `seed.js`:

```javascript
// 1. Create the skill entity
ensureEntity({ type: 'skill', name: 'my-tool', description: 'What it does', emoji: '🔧' });

// 2. Add natural-language aliases (what a user would actually say)
addAlias('my-tool', 'run the thing', 'check thing status', 'thing health');

// 3. Add attributes
addAttr('my-tool', 'port', '8080');
addAttr('my-tool', 'gotcha', 'Must restart after config change');

// 4. Create an action with its script
ensureEntity({ type: 'action', name: 'my-tool-status', description: 'Check status' });
addAttr('my-tool-status', 'script', 'curl -s http://localhost:8080/status');
addAlias('my-tool-status', 'is thing running', 'thing health check');

// 5. Wire the relationship
addEdge('my-tool', 'my-tool-status', 'provides');
```

Then rebuild:

```bash
node seed.js
npm test        # verify resolution still works
```

## Self-Healing Telemetry

SkillGraph includes a feedback loop:

1. **Every `resolve_skill` call** → logged to `resolve-skill.jsonl`
2. **Agent overrides** → logged to `resolve-skill-misses.jsonl` (via `scripts/graph-resolve-miss.sh`)
3. **Daily audit** → `scripts/graph-optimize.sh` runs the test suite, analyzes misses, flags low-confidence resolves
4. **Review** → `scripts/graph-resolve-review.sh` groups misses by target and suggests alias additions

The audit is **read-only** — it never auto-modifies the database. Changes go through `seed.js`.

## Testing

```bash
# Full test suite (70+ cases across all skill areas)
bash tests/run-skillgraph-tests.sh

# In-process unit tests
npm test

# Target: >90% pass rate
```

## Files

| File | Purpose |
|------|---------|
| `resolve.js` | Core resolver — CLI + importable `resolve()` function |
| `seed.js` | Authoritative data source — wipes and rebuilds the DB |
| `init-db.js` | Schema creation (tables + indexes) |
| `query.js` | Rich query tool (resolve, entity, workflow, list) |
| `visualize.js` | Interactive D3.js graph viewer |
| `test.js` | In-process test runner |
| `scripts/` | Telemetry: logging, miss tracking, daily audit, review |
| `tests/` | Automated test suite (70+ cases) |

## Design Decisions

1. **Use-case-first aliases** — Every alias is a real phrase someone would say, not an abstract category
2. **Seed is authoritative** — `seed.js` wipes and rebuilds; the DB is derived state
3. **String matching first, vectors second** — Deterministic, fast, debuggable; vector fallback only when needed
4. **Actions carry the details** — Skills are routing targets; actions carry the executable commands
5. **Logging never breaks resolution** — All telemetry is wrapped in try/catch
6. **Audit-only telemetry** — The daily cron suggests changes but never auto-modifies the database

## License

MIT
