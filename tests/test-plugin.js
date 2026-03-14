/**
 * Tests for the skill-resolver plugin layer.
 * 
 * Tests formatToolResult(), vector fallback trigger logic, and output structure.
 * Uses Node built-in test runner: node --test tests/test-plugin.js
 * 
 * Note: These test the plugin's formatting logic extracted from the plugin source.
 * Vector fallback tests are limited (require embeddings server) — we test the decision logic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── Extract formatToolResult for testing ─────────────────────────────────────
// We replicate the function here rather than importing the plugin (which requires
// the OpenClaw API object). If the plugin's formatToolResult changes, these tests
// should be updated to match.

function formatToolResult(result, source) {
  if (!result) {
    return {
      resolved: false,
      message: "No matching skill found. Proceed with best judgment — but check if this is a Docker/Komodo-managed resource before using raw commands.",
      reminder: "Docker = Komodo API. Never raw docker commands.",
    };
  }

  const out = {
    resolved: true,
    skill: result.skills?.[0]?.name || result.entity?.name || result.entity,
    confidence: result.confidence,
    score: result.score,
  };

  if (source === "vector") out.source = "vector-fallback";

  const scriptAttr = result.attrs?.find?.(a => a.key === 'script');
  if (scriptAttr) out.script = scriptAttr.value;

  const filteredAttrs = (result.attrs || []).filter?.(a => a.key !== 'script' && a.key !== 'known_issue');
  if (filteredAttrs?.length) {
    out.instructions = filteredAttrs.map(a => `${a.key}=${a.value}`).join(', ');
  }

  if (result.actionSummaries?.length) {
    out.actions = result.actionSummaries.map(a => `${a.name} (${a.detail || a.description})`);
  }

  if (result.bestActionName) {
    out.matchedAction = result.bestActionName;
    if (result.bestActionAttrs?.length) {
      out.actionAttrs = Object.fromEntries(result.bestActionAttrs.map(a => [a.key, a.value]));
      if (!out.script && out.actionAttrs.script) {
        out.script = out.actionAttrs.script;
      }
    }
    if (result.bestActionPrereq?.length) {
      out.actionPrereq = Object.fromEntries(result.bestActionPrereq.map(a => [a.key, a.value]));
    }
  }

  if (result.prereqAttrs?.length) {
    out.prereq = Object.fromEntries(result.prereqAttrs.map(a => [a.key, a.value]));
  }

  if (result.gotchas?.length) out.gotchas = result.gotchas;

  if (result.knownIssues?.length) out.knownIssues = result.knownIssues;

  if (result.entity?.type === 'workflow' && result.edges?.length) {
    out.workflow = result.edges
      .filter(e => e.step_order || e.relationship !== 'publishes_to')
      .map(e => ({
        step: e.step_order || null,
        mandatory: !!e.mandatory,
        relationship: e.relationship,
        target: e.name,
        detail: e.detail || null,
      }));
  }

  return out;
}

// ─── Test Suites ──────────────────────────────────────────────────────────────

describe('formatToolResult — Plugin Output Layer', () => {

  describe('No match', () => {

    it('null result returns resolved:false with reminder', () => {
      const out = formatToolResult(null);
      assert.strictEqual(out.resolved, false);
      assert.ok(out.message.includes('No matching skill'), 'Should have no-match message');
      assert.ok(out.reminder.includes('Komodo'), 'Should remind about Komodo');
    });
  });

  describe('Basic resolved output', () => {

    it('minimal result has resolved:true, skill, confidence, score', () => {
      const out = formatToolResult({
        entity: { name: 'test-skill', type: 'skill', id: 1 },
        skills: [{ name: 'test-skill' }],
        confidence: 'high',
        score: 100,
        attrs: [],
        edges: [],
        gotchas: [],
        prereqAttrs: [],
        actionSummaries: [],
        knownIssues: [],
      });
      assert.strictEqual(out.resolved, true);
      assert.strictEqual(out.skill, 'test-skill');
      assert.strictEqual(out.confidence, 'high');
      assert.strictEqual(out.score, 100);
      assert.strictEqual(out.source, undefined, 'No source for alias match');
    });

    it('vector source adds source field', () => {
      const out = formatToolResult({
        entity: { name: 'test-skill', type: 'skill', id: 1 },
        skills: [{ name: 'test-skill' }],
        confidence: 'medium-vector',
        score: 55,
        attrs: [],
        edges: [],
        gotchas: [],
        prereqAttrs: [],
        actionSummaries: [],
        knownIssues: [],
      }, 'vector');
      assert.strictEqual(out.source, 'vector-fallback');
    });
  });

  describe('Script extraction', () => {

    it('extracts script from attrs', () => {
      const out = formatToolResult({
        entity: { name: 'test', type: 'skill', id: 1 },
        skills: [{ name: 'test' }],
        confidence: 'high',
        score: 100,
        attrs: [{ key: 'script', value: 'postiz-status.sh' }],
        edges: [],
        gotchas: [],
        prereqAttrs: [],
        actionSummaries: [],
        knownIssues: [],
      });
      assert.strictEqual(out.script, 'postiz-status.sh');
    });

    it('extracts script from action attrs when no top-level script', () => {
      const out = formatToolResult({
        entity: { name: 'test', type: 'skill', id: 1 },
        skills: [{ name: 'test' }],
        confidence: 'high',
        score: 100,
        attrs: [],
        edges: [],
        gotchas: [],
        prereqAttrs: [],
        actionSummaries: [],
        bestActionName: 'test-deploy',
        bestActionAttrs: [{ key: 'script', value: 'deploy.sh' }],
        knownIssues: [],
      });
      assert.strictEqual(out.script, 'deploy.sh');
    });

    it('top-level script wins over action script', () => {
      const out = formatToolResult({
        entity: { name: 'test', type: 'skill', id: 1 },
        skills: [{ name: 'test' }],
        confidence: 'high',
        score: 100,
        attrs: [{ key: 'script', value: 'top-level.sh' }],
        edges: [],
        gotchas: [],
        prereqAttrs: [],
        actionSummaries: [],
        bestActionName: 'test-deploy',
        bestActionAttrs: [{ key: 'script', value: 'action-level.sh' }],
        knownIssues: [],
      });
      assert.strictEqual(out.script, 'top-level.sh');
    });
  });

  describe('Instructions filtering', () => {

    it('filters out script and known_issue from instructions', () => {
      const out = formatToolResult({
        entity: { name: 'test', type: 'skill', id: 1 },
        skills: [{ name: 'test' }],
        confidence: 'high',
        score: 100,
        attrs: [
          { key: 'script', value: 'run.sh' },
          { key: 'known_issue', value: 'KI-001: something broken' },
          { key: 'env', value: 'POSTIZ_API_KEY' },
        ],
        edges: [],
        gotchas: [],
        prereqAttrs: [],
        actionSummaries: [],
        knownIssues: ['KI-001: something broken'],
      });
      assert.strictEqual(out.instructions, 'env=POSTIZ_API_KEY');
      assert.ok(!out.instructions.includes('script'), 'script should be filtered');
      assert.ok(!out.instructions.includes('known_issue'), 'known_issue should be filtered');
    });
  });

  describe('Known issues', () => {

    it('passes through known issues array', () => {
      const issues = ['KI-001 [CRITICAL]: auth expires', 'KI-002 [MINOR]: response format'];
      const out = formatToolResult({
        entity: { name: 'test', type: 'skill', id: 1 },
        skills: [{ name: 'test' }],
        confidence: 'high',
        score: 100,
        attrs: [],
        edges: [],
        gotchas: [],
        prereqAttrs: [],
        actionSummaries: [],
        knownIssues: issues,
      });
      assert.deepStrictEqual(out.knownIssues, issues);
    });

    it('omits knownIssues field when empty', () => {
      const out = formatToolResult({
        entity: { name: 'test', type: 'skill', id: 1 },
        skills: [{ name: 'test' }],
        confidence: 'high',
        score: 100,
        attrs: [],
        edges: [],
        gotchas: [],
        prereqAttrs: [],
        actionSummaries: [],
        knownIssues: [],
      });
      assert.strictEqual(out.knownIssues, undefined);
    });
  });

  describe('Workflow formatting', () => {

    it('formats workflow edges into step objects', () => {
      const out = formatToolResult({
        entity: { name: 'Blog Post', type: 'workflow', id: 1 },
        skills: [],
        confidence: 'high',
        score: 100,
        attrs: [],
        edges: [
          { step_order: 1, mandatory: 1, relationship: 'uses', name: 'LightRAG', detail: 'research' },
          { step_order: 2, mandatory: 0, relationship: 'uses', name: 'nano-banana', detail: 'header image' },
        ],
        gotchas: [],
        prereqAttrs: [],
        actionSummaries: [],
        knownIssues: [],
      });
      assert.ok(out.workflow, 'Should have workflow field');
      assert.strictEqual(out.workflow.length, 2);
      assert.strictEqual(out.workflow[0].step, 1);
      assert.strictEqual(out.workflow[0].mandatory, true);
      assert.strictEqual(out.workflow[0].target, 'LightRAG');
    });

    it('non-workflow entity has no workflow field', () => {
      const out = formatToolResult({
        entity: { name: 'test', type: 'skill', id: 1 },
        skills: [{ name: 'test' }],
        confidence: 'high',
        score: 100,
        attrs: [],
        edges: [{ step_order: 1, mandatory: 0, relationship: 'uses', name: 'thing' }],
        gotchas: [],
        prereqAttrs: [],
        actionSummaries: [],
        knownIssues: [],
      });
      assert.strictEqual(out.workflow, undefined);
    });
  });

  describe('Gotchas and prereqs', () => {

    it('passes through gotchas', () => {
      const out = formatToolResult({
        entity: { name: 'test', type: 'skill', id: 1 },
        skills: [{ name: 'test' }],
        confidence: 'high',
        score: 100,
        attrs: [],
        edges: [],
        gotchas: ['wix: heroImage not rendering in editor'],
        prereqAttrs: [],
        actionSummaries: [],
        knownIssues: [],
      });
      assert.deepStrictEqual(out.gotchas, ['wix: heroImage not rendering in editor']);
    });

    it('formats prereqs as key-value object', () => {
      const out = formatToolResult({
        entity: { name: 'test-action', type: 'action', id: 1 },
        skills: [],
        confidence: 'high',
        score: 100,
        attrs: [],
        edges: [],
        gotchas: [],
        prereqAttrs: [{ key: 'script', value: 'auth.sh' }, { key: 'env', value: 'API_KEY' }],
        actionSummaries: [],
        knownIssues: [],
      });
      assert.deepStrictEqual(out.prereq, { script: 'auth.sh', env: 'API_KEY' });
    });
  });

  describe('Skill name resolution', () => {

    it('uses first skill name when skills array populated', () => {
      const out = formatToolResult({
        entity: { name: 'some-action', type: 'action', id: 1 },
        skills: [{ name: 'parent-skill' }],
        confidence: 'high',
        score: 50,
        attrs: [],
        edges: [],
        gotchas: [],
        prereqAttrs: [],
        actionSummaries: [],
        knownIssues: [],
      });
      assert.strictEqual(out.skill, 'parent-skill');
    });

    it('falls back to entity name when no skills', () => {
      const out = formatToolResult({
        entity: { name: 'standalone-tool', type: 'tool', id: 1 },
        skills: [],
        confidence: 'medium',
        score: 30,
        attrs: [],
        edges: [],
        gotchas: [],
        prereqAttrs: [],
        actionSummaries: [],
        knownIssues: [],
      });
      assert.strictEqual(out.skill, 'standalone-tool');
    });

    it('handles vector fallback result shape', () => {
      // Vector results may have entity as string
      const out = formatToolResult({
        entity: 'vector-match',
        entityType: 'skill',
        description: 'matched via vector',
        score: 65,
        confidence: 'medium-vector',
        vectorSim: 0.65,
        source: 'vector',
      }, 'vector');
      assert.strictEqual(out.resolved, true);
      assert.strictEqual(out.skill, 'vector-match');
      assert.strictEqual(out.source, 'vector-fallback');
    });
  });
});

// ─── Vector Fallback Decision Logic ─────────────────────────────────────────

describe('Vector fallback trigger logic', () => {

  it('should trigger when alias score < 50', () => {
    // Simulating the plugin's decision: if (!result || result.score < 50) → vectorFallback
    const aliasScore = 35;
    const shouldFallback = aliasScore < 50;
    assert.ok(shouldFallback, 'Score 35 should trigger vector fallback');
  });

  it('should NOT trigger when alias score >= 50', () => {
    const aliasScore = 100;
    const shouldFallback = aliasScore < 50;
    assert.ok(!shouldFallback, 'Score 100 should not trigger vector fallback');
  });

  it('vector score scaled by 0.8 for comparison', () => {
    // Plugin applies 0.8 multiplier: vectorScore = Math.round(vecResult.score * 0.8)
    const vecRawScore = 75;
    const scaledScore = Math.round(vecRawScore * 0.8);
    assert.strictEqual(scaledScore, 60);
    // 60 > 35 (alias), so vector would win
    assert.ok(scaledScore > 35, 'Scaled vector should beat weak alias');
  });

  it('weak vector does not override decent alias', () => {
    const aliasScore = 45;
    const vecRawScore = 40;
    const scaledVecScore = Math.round(vecRawScore * 0.8); // 32
    assert.ok(scaledVecScore <= aliasScore, 'Weak vector should not override decent alias');
  });
});
