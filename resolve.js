/**
 * graph-resolve: Compact skill resolver for agent use.
 * 
 * Usage: node resolve.js "check status of ollama"
 * 
 * Returns minimal, token-efficient output.
 */

import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { appendFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'skillgraph.db');

const db = new Database(DB_PATH, { readonly: true });
db.pragma('foreign_keys = ON');

const STOPWORDS = new Set(['a', 'an', 'the', 'to', 'for', 'of', 'in', 'on', 'is', 'it', 'my', 'me', 'do', 'i', 'we', 'and', 'or', 'can', 'you', 'how', 'what', 'with', 'this', 'that', 'please', 'just', 'up', 'let', 'want', 'need', 'some', 'any', 'now', 'about', 'give', 'tell', 'from', 'all', 'so', 'if', 'be', 'at', 'by', 'no', 'yes']);

function resolve(task, opts = {}) {
  const t = task.toLowerCase().trim();
  const words = t.split(/\s+/).filter(w => !STOPWORDS.has(w) && w.length >= 2);
  const scores = new Map();

  // Exact alias
  for (const m of db.prepare('SELECT e.* FROM entities e JOIN aliases a ON a.entity_id=e.id WHERE a.alias=?').all(t))
    scores.set(m.id, { e: m, s: 100 });

  // Multi-word phrase
  for (let len = words.length; len >= 2; len--) {
    for (let i = 0; i <= words.length - len; i++) {
      const phrase = words.slice(i, i + len).join(' ');
      for (const m of db.prepare('SELECT e.* FROM entities e JOIN aliases a ON a.entity_id=e.id WHERE a.alias=?').all(phrase)) {
        const sc = 50 + len * 10;
        if (!scores.has(m.id) || scores.get(m.id).s < sc) scores.set(m.id, { e: m, s: sc });
      }
    }
  }

  // Bag-of-words overlap: catches non-contiguous matches like "create event" in "create calendar event"
  // Only check multi-word aliases (single-word aliases are handled below)
  if (words.length >= 2) {
    const wordSet = new Set(words);
    for (const m of db.prepare('SELECT e.*, a.alias FROM entities e JOIN aliases a ON a.entity_id=e.id').all()) {
      const aliasWords = m.alias.split(/\s+/).filter(w => !STOPWORDS.has(w) && w.length >= 2);
      if (aliasWords.length < 2) continue;
      const overlap = aliasWords.filter(w => wordSet.has(w)).length;
      if (overlap < 2) continue; // need at least 2 matching words
      // Score: base 35 + 10 per matching word + bonus if ALL alias words matched
      const sc = 35 + overlap * 10 + (overlap === aliasWords.length ? 10 : 0);
      if (!scores.has(m.id) || scores.get(m.id).s < sc) scores.set(m.id, { e: m, s: sc });
    }
  }

  // Single word
  for (const w of words) {
    for (const m of db.prepare('SELECT e.* FROM entities e JOIN aliases a ON a.entity_id=e.id WHERE a.alias=?').all(w)) {
      const sc = 20 + (m.type === 'workflow' ? 5 : 0);
      if (!scores.has(m.id) || scores.get(m.id).s < sc) scores.set(m.id, { e: m, s: sc });
    }
  }

  // Description fallback
  for (const w of words) {
    if (w.length < 4) continue;
    for (const m of db.prepare('SELECT * FROM entities WHERE LOWER(name) LIKE ? OR LOWER(description) LIKE ?').all(`%${w}%`, `%${w}%`)) {
      if (!scores.has(m.id)) scores.set(m.id, { e: m, s: 10 });
    }
  }

  if (scores.size === 0) { console.log('NO_MATCH'); return; }

  // Tiebreaker: skill > action > tool > workflow > stack > other
  const TYPE_RANK = { skill: 6, action: 5, tool: 4, workflow: 3, stack: 2 };
  const best = [...scores.values()].sort((a, b) => {
    if (b.s !== a.s) return b.s - a.s;
    return (TYPE_RANK[b.e.type] || 0) - (TYPE_RANK[a.e.type] || 0);
  })[0];
  const entity = best.e;
  const conf = best.s >= 50 ? 'high' : best.s >= 20 ? 'medium' : 'low';

  // Get skills (by type, not by path)
  const skills = [];
  if (entity.type === 'skill') {
    skills.push({ name: entity.name });
  }

  const edges = db.prepare(`
    SELECT e2.name, e2.type, ed.relationship, ed.step_order, ed.mandatory, ed.detail
    FROM edges ed JOIN entities e2 ON e2.id=ed.target_id
    WHERE ed.source_id=? ORDER BY ed.step_order ASC NULLS LAST
  `).all(entity.id);

  for (const edge of edges) {
    if (edge.type === 'skill' && !skills.find(s => s.name === edge.name)) {
      skills.push({ name: edge.name });
    }
  }

  // Parent traversal for stacks/actions
  if (entity.type === 'stack' || entity.type === 'action') {
    const parents = db.prepare(`
      SELECT e2.name, e2.type FROM edges ed JOIN entities e2 ON e2.id=ed.target_id
      WHERE ed.source_id=? AND ed.relationship='managed_by'
      UNION
      SELECT e2.name, e2.type FROM edges ed JOIN entities e2 ON e2.id=ed.source_id
      WHERE ed.target_id=? AND ed.relationship IN ('provides','manages')
    `).all(entity.id, entity.id);
    for (const p of parents) {
      if (!skills.find(s => s.name === p.name)) skills.unshift({ name: p.name });
    }
  }

  const attrs = db.prepare('SELECT key, value FROM attrs WHERE entity_id=?').all(entity.id);

  // Gotchas
  const gotchas = [];
  for (const edge of edges) {
    if (edge.type !== 'skill') continue;
    const eId = db.prepare('SELECT id FROM entities WHERE name=?').get(edge.name)?.id;
    if (!eId) continue;
    for (const g of db.prepare("SELECT value FROM attrs WHERE entity_id=? AND key='gotcha'").all(eId))
      gotchas.push(`${edge.name}: ${g.value}`);
  }

  // --- Prereq chain for actions ---
  let prereqAttrs = [];
  if (entity.type === 'action') {
    const prereqName = attrs.find(a => a.key === 'prereq')?.value;
    if (prereqName) {
      const prereqEntity = db.prepare('SELECT id, name, description FROM entities WHERE name=?').get(prereqName);
      if (prereqEntity) {
        prereqAttrs = db.prepare('SELECT key, value FROM attrs WHERE entity_id=?').all(prereqEntity.id);
      }
    }
  }

  // --- For skills: include action summaries + best-matching action drill-down ---
  let actionSummaries = [];
  let bestActionAttrs = [];
  let bestActionPrereq = [];
  let bestActionName = null;
  if (entity.type === 'skill') {
    const actions = db.prepare(`
      SELECT e2.id, e2.name, e2.description, ed.detail
      FROM edges ed JOIN entities e2 ON e2.id=ed.target_id
      WHERE ed.source_id=? AND ed.relationship='provides' AND e2.type='action'
    `).all(entity.id);
    actionSummaries = actions;

    // Find the best-matching child action using two signals:
    // 1. Score from the main scoring pool (phrase/word/description matches)
    // 2. Alias word overlap with the query (more specific matching)
    // Pick whichever action has the highest combined relevance.
    let bestAction = null;
    let bestActionScore = 0;
    for (const action of actions) {
      let actionScore = 0;

      // Signal 1: main scoring pool (but only count phrase/word matches, not description fallback)
      const entry = scores.get(action.id);
      if (entry && entry.s > 10) actionScore = Math.max(actionScore, entry.s);

      // Signal 2: alias word overlap with query
      const actionAliases = db.prepare('SELECT alias FROM aliases WHERE entity_id=?').all(action.id);
      for (const { alias } of actionAliases) {
        const aliasWords = alias.toLowerCase().split(/\s+/);
        const overlap = words.filter(w => aliasWords.includes(w)).length;
        // Weight overlap heavily — each matching word is worth 15 points
        actionScore = Math.max(actionScore, overlap * 15);
      }

      if (actionScore > bestActionScore) {
        bestAction = action;
        bestActionScore = actionScore;
      }
    }

    // Drill down into the best-matching action
    if (bestAction) {
      bestActionName = bestAction.name;
      bestActionAttrs = db.prepare('SELECT key, value FROM attrs WHERE entity_id=?').all(bestAction.id);
      // Also get its prereq
      const prereqName = bestActionAttrs.find(a => a.key === 'prereq')?.value;
      if (prereqName) {
        const prereqEntity = db.prepare('SELECT id FROM entities WHERE name=?').get(prereqName);
        if (prereqEntity) {
          bestActionPrereq = db.prepare('SELECT key, value FROM attrs WHERE entity_id=?').all(prereqEntity.id);
        }
      }
    }
  }

  // --- Log to JSONL (skip if --no-log) ---
  if (!opts.noLog) try {
    const logDir = join(homedir(), 'clawd', 'logs');
    mkdirSync(logDir, { recursive: true });
    const logEntry = {
      ts: new Date().toISOString(),
      query: task,
      skill: skills[0]?.name || null,
      entity: entity.name,
      entityType: entity.type,
      confidence: conf,
      score: best.s,
      matchedAction: bestActionName || null,
      scriptAttr: attrs.find(a => a.key === 'script')?.value || null
    };
    appendFileSync(join(logDir, 'resolve-skill.jsonl'), JSON.stringify(logEntry) + '\n');
  } catch (_) { /* logging should never break resolution */ }

  // --- Compact output ---
  const lines = [];

  // Script shortcut: if a wrapper script exists, surface it first
  const scriptAttr = attrs.find(a => a.key === 'script');
  if (scriptAttr) {
    lines.push(`SCRIPT: ${scriptAttr.value}`);
  }

  if (skills.length) lines.push(skills.map(s => `SKILL: ${s.name}`).join('\n'));
  if (entity.type !== 'skill') lines.push(`ENTITY: ${entity.name} (${entity.type}) — ${entity.description}`);
  lines.push(`CONFIDENCE: ${conf} (score ${best.s})`);
  if (attrs.length) lines.push('ATTRS: ' + attrs.filter(a => a.key !== 'script').map(a => `${a.key}=${a.value}`).join(', '));

  // Prereq chain for actions
  if (prereqAttrs.length) {
    lines.push('PREREQ: ' + prereqAttrs.map(a => `${a.key}=${a.value}`).join(', '));
  }

  // Action summaries for skills
  if (actionSummaries.length) {
    lines.push('ACTIONS: ' + actionSummaries.map(a => `${a.name} (${a.detail || a.description})`).join(' | '));
  }

  // Best-matching action drill-down (when a skill entity won but a child action is relevant)
  if (bestActionName && bestActionAttrs.length) {
    // If the matched action has a script, surface it at the top
    const actionScript = bestActionAttrs.find(a => a.key === 'script');
    if (actionScript && !scriptAttr) {
      lines.unshift(`SCRIPT: ${actionScript.value}`);
    }
    lines.push(`MATCHED_ACTION: ${bestActionName}`);
    lines.push('ACTION_ATTRS: ' + bestActionAttrs.filter(a => a.key !== 'script').map(a => `${a.key}=${a.value}`).join(', '));
    if (bestActionPrereq.length) {
      lines.push('ACTION_PREREQ: ' + bestActionPrereq.map(a => `${a.key}=${a.value}`).join(', '));
    }
  }

  if (entity.type === 'workflow' && edges.length) {
    const steps = edges
      .filter(e => e.step_order || e.relationship !== 'publishes_to')
      .map(e => {
        const step = e.step_order ? `[${e.step_order}]` : '[-]';
        const mand = e.mandatory ? ' ⚠' : '';
        return `${step}${mand} ${e.relationship} → ${e.name}${e.detail ? ': ' + e.detail : ''}`;
      });
    if (steps.length) lines.push('WORKFLOW:\n' + steps.join('\n'));
  }

  if (gotchas.length) lines.push('GOTCHA: ' + gotchas.join(' | '));
  console.log(lines.join('\n'));
}

export { resolve };

// CLI entry point — only run when executed directly
if (process.argv[1] && process.argv[1].endsWith('resolve.js')) {
  const args = process.argv.slice(2);
  const noLog = args.includes('--no-log');
  const task = args.filter(a => a !== '--no-log').join(' ');
  if (!task) { console.log('Usage: node resolve.js "task description" [--no-log]'); process.exit(1); }
  resolve(task, { noLog });
  db.close();
}
