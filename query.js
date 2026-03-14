/**
 * graph-db: Query the skill knowledge graph.
 * 
 * Usage:
 *   node query.js resolve "write a blog post"
 *   node query.js resolve "check docker stacks"
 *   node query.js resolve "send an email"
 *   node query.js entity "Blog Post"
 *   node query.js workflow "Blog Post"
 *   node query.js list workflows
 *   node query.js list skills
 */

import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'skillgraph.db');

const db = new Database(DB_PATH, { readonly: true });
db.pragma('foreign_keys = ON');

// Stopwords to ignore in matching
const STOPWORDS = new Set(['a', 'an', 'the', 'to', 'for', 'of', 'in', 'on', 'is', 'it', 'my', 'me', 'do', 'i', 'we', 'and', 'or', 'can', 'you', 'how', 'what', 'with']);

/**
 * Resolve a task description to the best matching entity + its skills/workflow.
 * Returns the single best match with its full workflow chain.
 */
function resolve(taskDescription) {
  const task = taskDescription.toLowerCase().trim();
  const words = task.split(/\s+/).filter(w => !STOPWORDS.has(w) && w.length >= 2);

  // Score all entities
  const scores = new Map(); // entityId → { entity, score, matchType }

  // --- Pass 1: Exact alias match (highest priority) ---
  const exactMatches = db.prepare(`
    SELECT e.*, a.alias FROM entities e
    JOIN aliases a ON a.entity_id = e.id
    WHERE a.alias = ?
  `).all(task);

  for (const m of exactMatches) {
    scores.set(m.id, { entity: m, score: 100, matchType: 'exact_alias' });
  }

  // --- Pass 2: Multi-word phrase alias match ---
  // Try longest phrases first (more specific = higher score)
  for (let len = words.length; len >= 2; len--) {
    for (let i = 0; i <= words.length - len; i++) {
      const phrase = words.slice(i, i + len).join(' ');
      const matches = db.prepare(`
        SELECT e.*, a.alias FROM entities e
        JOIN aliases a ON a.entity_id = e.id
        WHERE a.alias = ?
      `).all(phrase);

      for (const m of matches) {
        const existing = scores.get(m.id);
        const phraseScore = 50 + (len * 10); // longer phrase = higher
        if (!existing || existing.score < phraseScore) {
          scores.set(m.id, { entity: m, score: phraseScore, matchType: 'phrase_alias' });
        }
      }
    }
  }

  // --- Pass 3: Single-word alias match (lower score, workflows preferred) ---
  for (const word of words) {
    const matches = db.prepare(`
      SELECT e.*, a.alias FROM entities e
      JOIN aliases a ON a.entity_id = e.id
      WHERE a.alias = ?
    `).all(word);

    for (const m of matches) {
      const existing = scores.get(m.id);
      // Workflows get a small boost since they're the top-level routing targets
      const typeBoost = m.type === 'workflow' ? 5 : 0;
      const wordScore = 20 + typeBoost;
      if (!existing || existing.score < wordScore) {
        scores.set(m.id, { entity: m, score: wordScore, matchType: 'word_alias' });
      }
    }
  }

  // --- Pass 4: Name/description LIKE match (lowest priority) ---
  for (const word of words) {
    if (word.length < 4) continue; // avoid short word noise
    const matches = db.prepare(`
      SELECT * FROM entities
      WHERE LOWER(name) LIKE ? OR LOWER(description) LIKE ?
    `).all(`%${word}%`, `%${word}%`);

    for (const m of matches) {
      if (!scores.has(m.id)) {
        scores.set(m.id, { entity: m, score: 10, matchType: 'description' });
      }
    }
  }

  if (scores.size === 0) {
    return { match: 'none', entities: [], skills: [], workflow: [] };
  }

  // Sort by score, take top 2 max
  const ranked = [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  // Build result from the best match only (for workflow/skills),
  // but show runner-up entity info for context
  const best = ranked[0];
  const result = buildResult(best.entity);

  return {
    match: best.matchType,
    confidence: best.score >= 50 ? 'high' : best.score >= 20 ? 'medium' : 'low',
    primary: {
      name: best.entity.name,
      type: best.entity.type,
      description: best.entity.description,
      emoji: best.entity.emoji,
      is_skill: best.entity.type === "skill",
      score: best.score
    },
    runner_up: ranked.length > 1 ? {
      name: ranked[1].entity.name,
      type: ranked[1].entity.type,
      score: ranked[1].score
    } : null,
    skills: result.skills,
    workflow: result.workflow,
    attributes: result.attributes,
    gotchas: result.gotchas
  };
}

/**
 * Build skills + workflow for a single entity.
 */
function buildResult(entity) {
  const skills = [];
  const workflow = [];
  const gotchas = [];

  // Get outgoing edges
  const edges = db.prepare(`
    SELECT e2.*, ed.relationship, ed.step_order, ed.mandatory, ed.detail
    FROM edges ed
    JOIN entities e2 ON e2.id = ed.target_id
    WHERE ed.source_id = ?
    ORDER BY ed.step_order ASC NULLS LAST
  `).all(entity.id);

  for (const edge of edges) {
    workflow.push({
      target: edge.name,
      type: edge.type,
      relationship: edge.relationship,
      step: edge.step_order,
      mandatory: !!edge.mandatory,
      detail: edge.detail,
      is_skill: edge.type === "skill"
    });

    if (edge.type === 'skill' && edge.type === "skill") {
      skills.push({
        name: edge.name,
        path: edge.type === "skill",
        relationship: edge.relationship,
        mandatory: !!edge.mandatory,
        step: edge.step_order,
        detail: edge.detail
      });
    }

    // Check for gotchas on connected skills
    const attrs = db.prepare(`SELECT key, value FROM attrs WHERE entity_id = ?`).all(edge.id);
    for (const attr of attrs) {
      if (attr.key === 'gotcha') {
        gotchas.push({ skill: edge.name, gotcha: attr.value });
      }
    }
  }

  // If the entity itself is a skill (direct skill match), return it
  if (entity.type === 'skill' && entity.type === "skill") {
    if (!skills.find(s => s.name === entity.name)) {
      skills.unshift({
        name: entity.name,
        path: entity.type === "skill",
        relationship: 'direct',
        mandatory: false,
        step: null,
        detail: entity.description
      });
    }
  }

  // If the entity is a stack/action, traverse managed_by edges to find the parent skill
  if (entity.type === 'stack' || entity.type === 'action') {
    // Check outgoing managed_by edges AND incoming "provides" edges (parent → this action)
    const parentEdges = db.prepare(`
      SELECT e2.*, ed.relationship, ed.detail
      FROM edges ed
      JOIN entities e2 ON e2.id = ed.target_id
      WHERE ed.source_id = ? AND ed.relationship IN ('managed_by')
      UNION
      SELECT e2.*, ed.relationship, ed.detail
      FROM edges ed
      JOIN entities e2 ON e2.id = ed.source_id
      WHERE ed.target_id = ? AND ed.relationship IN ('provides', 'manages')
    `).all(entity.id, entity.id);

    for (const parent of parentEdges) {
      if (parent.type === 'skill' && parent.type === "skill") {
        if (!skills.find(s => s.name === parent.name)) {
          skills.unshift({
            name: parent.name,
            path: parent.type === "skill",
            relationship: 'manages_this',
            mandatory: false,
            step: null,
            detail: parent.description
          });
        }
      }
    }
  }

  // Entity's own attributes
  const attributes = db.prepare(`SELECT key, value FROM attrs WHERE entity_id = ?`).all(entity.id);

  return { skills, workflow, attributes, gotchas };
}

/**
 * Get full details for a named entity.
 */
function getEntity(name) {
  const entity = db.prepare('SELECT * FROM entities WHERE name = ?').get(name);
  if (!entity) return null;

  entity.attributes = db.prepare('SELECT key, value FROM attrs WHERE entity_id = ?').all(entity.id);
  entity.aliases = db.prepare('SELECT alias FROM aliases WHERE entity_id = ?').all(entity.id).map(a => a.alias);
  
  entity.outgoing = db.prepare(`
    SELECT e2.name, e2.type, ed.relationship, ed.step_order, ed.mandatory, ed.detail
    FROM edges ed JOIN entities e2 ON e2.id = ed.target_id
    WHERE ed.source_id = ? ORDER BY ed.step_order ASC NULLS LAST
  `).all(entity.id);

  entity.incoming = db.prepare(`
    SELECT e2.name, e2.type, ed.relationship, ed.step_order, ed.mandatory, ed.detail
    FROM edges ed JOIN entities e2 ON e2.id = ed.source_id
    WHERE ed.target_id = ? ORDER BY ed.step_order ASC NULLS LAST
  `).all(entity.id);

  return entity;
}

/**
 * Get ordered workflow steps for a workflow entity.
 */
function getWorkflow(name) {
  const entity = db.prepare('SELECT * FROM entities WHERE name = ? AND type = ?').get(name, 'workflow');
  if (!entity) return null;

  const steps = db.prepare(`
    SELECT e2.name, e2.type, ed.relationship, ed.step_order, ed.mandatory, ed.detail
    FROM edges ed JOIN entities e2 ON e2.id = ed.target_id
    WHERE ed.source_id = ?
    ORDER BY ed.step_order ASC NULLS LAST
  `).all(entity.id);

  return { workflow: entity.name, description: entity.description, steps };
}

/**
 * List all entities of a given type.
 */
function listByType(type) {
  return db.prepare('SELECT name, description, emoji FROM entities WHERE type = ? ORDER BY name').all(type);
}

// --- CLI ---

const [,, command, ...args] = process.argv;
const arg = args.join(' ');

switch (command) {
  case 'resolve':
    console.log(JSON.stringify(resolve(arg), null, 2));
    break;
  case 'entity':
    console.log(JSON.stringify(getEntity(arg), null, 2));
    break;
  case 'workflow':
    console.log(JSON.stringify(getWorkflow(arg), null, 2));
    break;
  case 'list':
    console.log(JSON.stringify(listByType(arg), null, 2));
    break;
  default:
    console.log('Usage:');
    console.log('  node query.js resolve "write a blog post"');
    console.log('  node query.js entity "Blog Post"');
    console.log('  node query.js workflow "Blog Post"');
    console.log('  node query.js list workflows|skills|tools|sites|platforms');
}

db.close();
