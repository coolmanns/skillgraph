/**
 * graph-db: Initialize the skill knowledge graph database.
 * 
 * Schema:
 *   entities  — nodes (use cases, skills, tools, sites, devices)
 *   edges     — relationships between entities
 *   attrs     — key-value attributes on entities
 *   
 * Vector layer (sqlite-vec) deferred — relational first.
 */

import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'skillgraph.db');

const db = new Database(DB_PATH);

// WAL mode for concurrent reads
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- Core entity table
  CREATE TABLE IF NOT EXISTS entities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT NOT NULL,       -- workflow, skill, tool, site, device, api, platform
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    emoji       TEXT,
    skill_path  TEXT,                -- DEPRECATED: no longer used by resolver (column kept for schema compat)
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  -- Edges: directed relationships between entities
  CREATE TABLE IF NOT EXISTS edges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    target_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    relationship TEXT NOT NULL,      -- uses, requires, feeds, publishes_to, monitors, generates, manages
    step_order  INTEGER,             -- for ordered workflows (1, 2, 3...)
    mandatory   INTEGER DEFAULT 0,   -- 1 = required step, 0 = optional
    detail      TEXT,                -- freeform notes
    created_at  TEXT DEFAULT (datetime('now')),
    UNIQUE(source_id, target_id, relationship)
  );

  -- Key-value attributes on entities
  CREATE TABLE IF NOT EXISTS attrs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,
    UNIQUE(entity_id, key)
  );

  -- Aliases for fuzzy matching (e.g. "blog" → "Blog Post", "image" → "Image Generation")
  CREATE TABLE IF NOT EXISTS aliases (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    alias       TEXT NOT NULL UNIQUE
  );

  -- Indexes for common queries
  CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
  CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
  CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
  CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
  CREATE INDEX IF NOT EXISTS idx_edges_rel ON edges(relationship);
  CREATE INDEX IF NOT EXISTS idx_attrs_entity ON attrs(entity_id);
  CREATE INDEX IF NOT EXISTS idx_aliases_entity ON aliases(entity_id);
`);

console.log(`✅ skillgraph.db initialized at ${DB_PATH}`);
console.log(`   Tables: entities, edges, attrs, aliases`);

db.close();
