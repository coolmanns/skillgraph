/**
 * Unit tests for resolve.js — the core SkillGraph resolver.
 * 
 * Tests the matching engine directly (no CLI, no plugin layer).
 * Uses Node built-in test runner: node --test tests/test-resolve.js
 * 
 * Requires: better-sqlite3, skillgraph.db populated with test data
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, formatOutput, closeDb } from '../resolve.js';

// ─── Helper ───────────────────────────────────────────────────────────────────

function assertResolved(result, msg) {
  assert.ok(result !== null, `Expected a result, got null: ${msg}`);
}

function assertNotResolved(result, msg) {
  assert.strictEqual(result, null, `Expected null (no match), got: ${msg}`);
}

function assertConfidence(result, expected, msg) {
  assert.strictEqual(result.confidence, expected, `Confidence mismatch: ${msg}`);
}

function assertEntityName(result, name, msg) {
  assert.strictEqual(result.entity.name, name, `Entity name mismatch: ${msg}`);
}

function assertEntityType(result, type, msg) {
  assert.strictEqual(result.entity.type, type, `Entity type mismatch: ${msg}`);
}

function assertHasSkill(result, skillName, msg) {
  const found = result.skills.some(s => s.name === skillName);
  assert.ok(found, `Expected skill "${skillName}" in results: ${msg}`);
}

function assertScoreAbove(result, threshold, msg) {
  assert.ok(result.score >= threshold, `Score ${result.score} < ${threshold}: ${msg}`);
}

function assertScoreBelow(result, threshold, msg) {
  assert.ok(result.score < threshold, `Score ${result.score} >= ${threshold}: ${msg}`);
}

// ─── Test Suites ──────────────────────────────────────────────────────────────

describe('resolve.js — Core Resolver', () => {

  after(() => closeDb());

  // ─── Scoring Tiers ────────────────────────────────────────────────────────

  describe('Scoring tiers', () => {

    it('exact alias → score 100, high confidence', () => {
      const r = resolve('docker', { noLog: true });
      assertResolved(r, 'docker');
      assert.strictEqual(r.score, 100);
      assertConfidence(r, 'high', 'exact alias');
    });

    it('exact multi-word alias → score 100', () => {
      const r = resolve('check status of ollama', { noLog: true });
      assertResolved(r, 'check status of ollama');
      assert.strictEqual(r.score, 100);
    });

    it('multi-word phrase match → score 50+', () => {
      // Use a query that contains a phrase matching a multi-word alias but isn't exact
      const r = resolve('please check social media queue now', { noLog: true });
      assertResolved(r, 'social media queue');
      assertScoreAbove(r, 50, 'multi-word phrase');
      assertConfidence(r, 'high', 'multi-word phrase');
    });

    it('exact alias match for entity name → score 100', () => {
      // 'komodo' is both the entity name AND an alias (added 2026-03-06)
      const r = resolve('komodo', { noLog: true });
      assertResolved(r, 'komodo exact alias');
      assert.strictEqual(r.score, 100, 'komodo exact alias = 100');
      assertConfidence(r, 'high', 'exact alias');
    });

    it('single alias word in multi-word query → score 20+', () => {
      // 'deploy' is a komodo alias; adding non-alias words should give single-word tier
      const r = resolve('deploy stuff', { noLog: true });
      assertResolved(r, 'single alias word in context');
      assertScoreAbove(r, 20, 'single alias word');
    });

    it('description fallback → score ~10, low confidence', () => {
      // Use a long word that only appears in a description, not in aliases
      const r = resolve('autoarchive', { noLog: true });
      // This might or might not match depending on DB content
      // If it matches, should be low score
      if (r) {
        assertScoreBelow(r, 20, 'description fallback should score low');
      }
    });

    it('no match → returns null', () => {
      const r = resolve('xyzzy_nonexistent_skill_foobar', { noLog: true });
      assertNotResolved(r, 'gibberish query');
    });
  });

  // ─── Stopword Handling ────────────────────────────────────────────────────

  describe('Stopword handling', () => {

    it('strips stopwords from query', () => {
      // "check the status of my docker containers" → stopwords stripped, matches komodo-related entity
      const r = resolve('check the status of my docker containers', { noLog: true });
      assertResolved(r, 'stopword-heavy query');
      // Should resolve to komodo skill or a komodo action (e.g. komodo-check-state)
      const isKomodoRelated = r.entity.name.includes('komodo') || r.skills.some(s => s.name === 'komodo');
      assert.ok(isKomodoRelated, `Should resolve to komodo-related entity, got: ${r.entity.name}`);
    });

    it('query of only stopwords → returns null', () => {
      const r = resolve('the a an to for of in on', { noLog: true });
      assertNotResolved(r, 'all-stopword query');
    });

    it('empty query → returns null', () => {
      const r = resolve('', { noLog: true });
      assertNotResolved(r, 'empty string');
    });

    it('whitespace-only query → returns null', () => {
      const r = resolve('   ', { noLog: true });
      assertNotResolved(r, 'whitespace only');
    });
  });

  // ─── Entity Type Tiebreakers ──────────────────────────────────────────────

  describe('Entity type tiebreakers', () => {

    it('skill type ranked higher than action at same score', () => {
      // When both a skill and action match with same score, skill wins
      // We test this by checking the TYPE_RANK ordering
      const r = resolve('komodo', { noLog: true });
      assertResolved(r, 'komodo tiebreaker');
      // komodo is a skill entity — should win over any action with same name
      assertEntityType(r, 'skill', 'skill should win tiebreak');
    });
  });

  // ─── Known Issues ─────────────────────────────────────────────────────────

  describe('Known issues surfacing', () => {

    it('wix-api returns known issues (via hyphenated name)', () => {
      // 'wix-api' is the entity name (description fallback), 'wix api' matches wix-create-post action
      const r = resolve('wix-api', { noLog: true });
      assertResolved(r, 'wix known issues');
      assert.ok(r.knownIssues.length > 0, 'Should have known issues');
      assert.ok(r.knownIssues.some(ki => ki.includes('KI-001')), 'Should include KI-001');
    });

    it('postiz returns known issues', () => {
      const r = resolve('postiz', { noLog: true });
      assertResolved(r, 'postiz known issues');
      assert.ok(r.knownIssues.length > 0, 'Should have known issues');
      assert.ok(r.knownIssues.some(ki => ki.toLowerCase().includes('cookie auth')), 'Should include cookie auth KI');
    });

    it('entity without known issues returns empty array', () => {
      const r = resolve('komodo', { noLog: true });
      assertResolved(r, 'komodo no KIs');
      assert.ok(Array.isArray(r.knownIssues), 'knownIssues should be array');
      // komodo may or may not have KIs, but the field must exist
    });
  });

  // ─── Attrs ────────────────────────────────────────────────────────────────

  describe('Attrs retrieval', () => {

    it('returns script attr when present', () => {
      // Postiz actions should have script attrs
      const r = resolve('check social media queue', { noLog: true });
      assertResolved(r, 'script attr');
      const hasScript = r.attrs.some(a => a.key === 'script') ||
                        (r.bestActionAttrs && r.bestActionAttrs.some(a => a.key === 'script'));
      assert.ok(hasScript, 'Should have a script attribute somewhere');
    });

    it('known_issue attrs excluded from main attrs array', () => {
      const r = resolve('wix-api', { noLog: true });
      assertResolved(r, 'KI exclusion');
      const kiInAttrs = r.attrs.some(a => a.key === 'known_issue');
      assert.ok(!kiInAttrs, 'known_issue should NOT be in attrs array (separate field)');
    });
  });

  // ─── Prereq Chains ───────────────────────────────────────────────────────

  describe('Prereq chain resolution', () => {

    it('action with prereq returns prereqAttrs', () => {
      // postiz-list-posts has prereq=postiz-auth
      const r = resolve('postiz-list-posts', { noLog: true });
      if (r && r.entity.type === 'action') {
        assert.ok(r.prereqAttrs.length > 0, 'Should have prereq attrs from postiz-auth');
      }
    });

    it('skill with actions resolves best matching action prereqs', () => {
      const r = resolve('list all posts on postiz', { noLog: true });
      assertResolved(r, 'postiz action prereq');
      // If the best action has a prereq, bestActionPrereq should be populated
      if (r.bestActionName && r.bestActionPrereq) {
        assert.ok(Array.isArray(r.bestActionPrereq), 'bestActionPrereq should be array');
      }
    });
  });

  // ─── Action Drill-Down ────────────────────────────────────────────────────

  describe('Action drill-down', () => {

    it('skill entity returns actionSummaries', () => {
      const r = resolve('komodo', { noLog: true });
      assertResolved(r, 'komodo actions');
      if (r.entity.type === 'skill') {
        assert.ok(r.actionSummaries.length > 0, 'komodo skill should have actions');
      }
    });

    it('best action matched from query words', () => {
      const r = resolve('deploy a docker stack via komodo', { noLog: true });
      assertResolved(r, 'komodo deploy');
      // Should drill down to the deploy action
      if (r.bestActionName) {
        assert.ok(r.bestActionName.toLowerCase().includes('deploy') ||
                   r.bestActionAttrs.some(a => a.value.includes('deploy')),
                   'Should match deploy action');
      }
    });

    it('non-skill entity has empty actionSummaries', () => {
      // Direct action match shouldn't have actionSummaries
      const r = resolve('postiz-list-posts', { noLog: true });
      if (r && r.entity.type === 'action') {
        assert.deepStrictEqual(r.actionSummaries, [], 'Action entity should have empty actionSummaries');
      }
    });
  });

  // ─── Edge Traversal ───────────────────────────────────────────────────────

  describe('Edge traversal', () => {

    it('returns edges for matched entity', () => {
      const r = resolve('komodo', { noLog: true });
      assertResolved(r, 'komodo edges');
      assert.ok(r.edges.length > 0, 'komodo should have edges');
    });

    it('workflow entity has ordered steps', () => {
      const r = resolve('blog post', { noLog: true });
      if (r && r.entity.type === 'workflow') {
        const ordered = r.edges.filter(e => e.step_order !== null);
        assert.ok(ordered.length > 0, 'Workflow should have ordered steps');
        // Verify ordering
        for (let i = 1; i < ordered.length; i++) {
          assert.ok(ordered[i].step_order >= ordered[i-1].step_order,
            'Steps should be in ascending order');
        }
      }
    });

    it('stack/action parent traversal finds managing skill', () => {
      // Stack entities should find their parent skill via managed_by/manages
      const r = resolve('ollama', { noLog: true });
      assertResolved(r, 'ollama parent traversal');
      // Should have komodo in skills via parent traversal
      if (r.entity.type === 'stack') {
        assertHasSkill(r, 'komodo', 'ollama stack should reference komodo skill');
      }
    });
  });

  // ─── Skills Array ─────────────────────────────────────────────────────────

  describe('Skills array population', () => {

    it('skill entity includes itself in skills array', () => {
      const r = resolve('postiz', { noLog: true });
      assertResolved(r, 'postiz self-skill');
      if (r.entity.type === 'skill') {
        assertHasSkill(r, 'postiz', 'skill should include itself');
      }
    });

    it('entity with skill edges includes those skills', () => {
      const r = resolve('komodo', { noLog: true });
      assertResolved(r, 'komodo skill edges');
      assert.ok(r.skills.length >= 1, 'Should have at least one skill');
    });
  });

  // ─── Result Structure ─────────────────────────────────────────────────────

  describe('Result structure', () => {

    it('result has all required fields', () => {
      const r = resolve('docker', { noLog: true });
      assertResolved(r, 'structure check');

      // Required fields
      assert.ok(r.entity, 'must have entity');
      assert.ok(r.entity.name, 'entity must have name');
      assert.ok(r.entity.type, 'entity must have type');
      assert.ok(r.entity.id, 'entity must have id');
      assert.ok(Array.isArray(r.skills), 'skills must be array');
      assert.ok(typeof r.confidence === 'string', 'confidence must be string');
      assert.ok(typeof r.score === 'number', 'score must be number');
      assert.ok(Array.isArray(r.attrs), 'attrs must be array');
      assert.ok(Array.isArray(r.edges), 'edges must be array');
      assert.ok(Array.isArray(r.gotchas), 'gotchas must be array');
      assert.ok(Array.isArray(r.prereqAttrs), 'prereqAttrs must be array');
      assert.ok(Array.isArray(r.actionSummaries), 'actionSummaries must be array');
      assert.ok(Array.isArray(r.knownIssues), 'knownIssues must be array');
    });

    it('confidence values are valid', () => {
      const r = resolve('docker', { noLog: true });
      assertResolved(r, 'confidence values');
      assert.ok(['high', 'medium', 'low'].includes(r.confidence),
        `Confidence "${r.confidence}" not in valid set`);
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────────

  describe('Edge cases', () => {

    it('handles special characters in query', () => {
      const r = resolve("what's the status?", { noLog: true });
      // Should not throw — result may or may not match
      assert.ok(true, 'Did not throw on special chars');
    });

    it('handles SQL injection-shaped input', () => {
      const r = resolve("'; DROP TABLE entities; --", { noLog: true });
      // Should not throw, DB should be intact
      assert.ok(true, 'Did not throw on SQL injection attempt');
      // Verify DB is still readable
      const check = resolve('docker', { noLog: true });
      assertResolved(check, 'DB intact after injection attempt');
    });

    it('handles very long query', () => {
      const longQuery = 'check '.repeat(500) + 'docker';
      const r = resolve(longQuery, { noLog: true });
      // Should not throw — might be slow but shouldn't crash
      assert.ok(true, 'Did not throw on very long query');
    });

    it('handles unicode in query', () => {
      const r = resolve('deploy 🐳 container', { noLog: true });
      assert.ok(true, 'Did not throw on unicode');
    });

    it('noLog option prevents logging', () => {
      // This is a smoke test — we pass noLog:true and it shouldn't throw
      const r = resolve('docker', { noLog: true });
      assertResolved(r, 'noLog option');
    });
  });

  // ─── formatOutput ─────────────────────────────────────────────────────────

  describe('formatOutput', () => {

    it('null result → NO_MATCH', () => {
      assert.strictEqual(formatOutput(null), 'NO_MATCH');
    });

    it('includes SKILL line for skill entities', () => {
      const r = resolve('komodo', { noLog: true });
      const output = formatOutput(r);
      assert.ok(output.includes('SKILL:'), 'Should include SKILL: line');
    });

    it('includes CONFIDENCE line', () => {
      const r = resolve('docker', { noLog: true });
      const output = formatOutput(r);
      assert.ok(output.includes('CONFIDENCE:'), 'Should include CONFIDENCE: line');
    });

    it('includes SCRIPT line when script attr exists', () => {
      const r = resolve('check social media queue', { noLog: true });
      const output = formatOutput(r);
      // Check both top-level and action-level SCRIPT
      if (r.attrs.some(a => a.key === 'script') ||
          (r.bestActionAttrs && r.bestActionAttrs.some(a => a.key === 'script'))) {
        assert.ok(output.includes('SCRIPT:'), 'Should include SCRIPT: line');
      }
    });

    it('includes KNOWN_ISSUES section when present', () => {
      const r = resolve('wix-api', { noLog: true });
      const output = formatOutput(r);
      assert.ok(output.includes('KNOWN_ISSUES:'), 'Should include KNOWN_ISSUES: section');
    });

    it('includes WORKFLOW section for workflow entities', () => {
      const r = resolve('blog post', { noLog: true });
      if (r && r.entity.type === 'workflow') {
        const output = formatOutput(r);
        assert.ok(output.includes('WORKFLOW:'), 'Should include WORKFLOW: section');
      }
    });

    it('includes ACTIONS for skill entities with actions', () => {
      const r = resolve('komodo', { noLog: true });
      if (r.actionSummaries.length > 0) {
        const output = formatOutput(r);
        assert.ok(output.includes('ACTIONS:'), 'Should include ACTIONS: line');
      }
    });

    it('includes GOTCHA when gotchas exist', () => {
      const r = resolve('komodo', { noLog: true });
      if (r.gotchas.length > 0) {
        const output = formatOutput(r);
        assert.ok(output.includes('GOTCHA:'), 'Should include GOTCHA: line');
      }
    });
  });

  // ─── Regression: Known Good Routes ────────────────────────────────────────

  describe('Regression — critical routes', () => {

    it('docker → komodo (not raw docker)', () => {
      const r = resolve('docker', { noLog: true });
      assertResolved(r, 'docker → komodo');
      assertEntityName(r, 'komodo', 'docker must route to komodo');
    });

    it('container → komodo', () => {
      const r = resolve('container', { noLog: true });
      assertResolved(r, 'container → komodo');
      assertEntityName(r, 'komodo', 'container must route to komodo');
    });

    it('social media → postiz', () => {
      const r = resolve('check social media queue', { noLog: true });
      assertResolved(r, 'social → postiz');
      const isPostiz = r.entity.name === 'postiz' || r.skills.some(s => s.name === 'postiz');
      assert.ok(isPostiz, 'social media must route to postiz');
    });

    it('blog post creation → lobster pipeline', () => {
      const r = resolve('write a blog post', { noLog: true });
      assertResolved(r, 'blog → lobster');
      const isLobster = r.entity.name.includes('lobster') || r.skills.some(s => s.name.includes('lobster'));
      assert.ok(isLobster, 'blog post writing should route to lobster pipeline');
    });

    it('calendar → caldav', () => {
      const r = resolve('check my calendar', { noLog: true });
      assertResolved(r, 'calendar → caldav');
      const isCaldav = r.entity.name.includes('caldav') || r.skills.some(s => s.name.includes('caldav'));
      assert.ok(isCaldav, 'calendar must route to caldav');
    });

    it('email → himalaya', () => {
      const r = resolve('check email inbox', { noLog: true });
      assertResolved(r, 'email → himalaya');
      const isHimalaya = r.entity.name.includes('himalaya') || r.skills.some(s => s.name.includes('himalaya'));
      assert.ok(isHimalaya, 'email must route to himalaya');
    });

    it('image generation → nano-banana', () => {
      const r = resolve('generate an image', { noLog: true });
      assertResolved(r, 'image → nano-banana');
      const isNanoBanana = r.entity.name.includes('nano-banana') || r.skills.some(s => s.name.includes('nano-banana'));
      assert.ok(isNanoBanana, 'image generation must route to nano-banana');
    });

    it('grepai / code search → grepai', () => {
      const r = resolve('search code with grepai', { noLog: true });
      assertResolved(r, 'grepai');
      const isGrepai = r.entity.name.includes('grepai') || r.skills.some(s => s.name.includes('grepai'));
      assert.ok(isGrepai, 'code search must route to grepai');
    });
  });
});
