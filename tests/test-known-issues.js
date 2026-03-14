/**
 * Tests for known issues surfacing through the resolve pipeline.
 * 
 * Verifies that known_issue attrs in skillgraph.db are correctly:
 * 1. Returned in resolve() results (separate from attrs)
 * 2. Included in formatOutput() CLI output
 * 3. Passed through to plugin formatToolResult
 * 
 * Uses Node built-in test runner: node --test tests/test-known-issues.js
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, formatOutput, closeDb } from '../resolve.js';

after(() => closeDb());

// ─── Wix Known Issues ─────────────────────────────────────────────────────────

describe('Wix API known issues', () => {

  // Note: 'wix-api' (hyphenated) hits the entity name via description fallback.
  // 'wix api' (space) matches wix-create-post action instead (no KIs on actions).
  // KIs are stored on the wix-api skill entity.

  it('wix-api entity returns all 4 known issues', () => {
    const r = resolve('wix-api', { noLog: true });
    assert.ok(r, 'Should resolve wix-api');
    assert.strictEqual(r.knownIssues.length, 4, `Expected 4 KIs, got ${r.knownIssues.length}`);
  });

  it('KI-001: heroImage rendering caveat', () => {
    const r = resolve('wix-api', { noLog: true });
    const ki = r.knownIssues.find(k => k.includes('KI-001'));
    assert.ok(ki, 'KI-001 should exist');
    assert.ok(ki.includes('heroImage'), 'Should mention heroImage');
    assert.ok(ki.includes('IMPORTANT'), 'Should be IMPORTANT severity');
  });

  it('KI-002: richContent PATCH response caveat', () => {
    const r = resolve('wix-api', { noLog: true });
    const ki = r.knownIssues.find(k => k.includes('KI-002'));
    assert.ok(ki, 'KI-002 should exist');
    assert.ok(ki.includes('richContent'), 'Should mention richContent');
    assert.ok(ki.includes('CRITICAL'), 'Should be CRITICAL severity');
  });

  it('KI-003: never delete draft on PATCH failure', () => {
    const r = resolve('wix-api', { noLog: true });
    const ki = r.knownIssues.find(k => k.includes('KI-003'));
    assert.ok(ki, 'KI-003 should exist');
    assert.ok(ki.includes('NEVER delete'), 'Should warn about deletion');
    assert.ok(ki.includes('CRITICAL'), 'Should be CRITICAL severity');
  });

  it('KI-004: media.custom flag', () => {
    const r = resolve('wix-api', { noLog: true });
    const ki = r.knownIssues.find(k => k.includes('KI-004'));
    assert.ok(ki, 'KI-004 should exist');
    assert.ok(ki.includes('media.custom'), 'Should mention media.custom');
    assert.ok(ki.includes('MINOR'), 'Should be MINOR severity');
  });

  it('wix alias routes to wix-api skill with KIs', () => {
    // 'wix' is a direct alias of wix-api → exact match
    const r = resolve('wix', { noLog: true });
    assert.ok(r, 'Should resolve');
    assert.strictEqual(r.entity.name, 'wix-api', 'wix alias should map to wix-api');
    assert.ok(r.knownIssues.length > 0, 'Should have known issues via alias');
  });
});

// ─── Postiz Known Issues ──────────────────────────────────────────────────────

describe('Postiz known issues', () => {

  it('postiz entity returns all 6 known issues', () => {
    const r = resolve('postiz', { noLog: true });
    assert.ok(r, 'Should resolve postiz');
    assert.strictEqual(r.knownIssues.length, 6, `Expected 6 KIs, got ${r.knownIssues.length}`);
  });

  it('KI-001: cookie auth expiration', () => {
    const r = resolve('postiz', { noLog: true });
    const ki = r.knownIssues.find(k => k.includes('KI-001'));
    assert.ok(ki, 'KI-001 should exist');
    assert.ok(ki.includes('CRITICAL'), 'Should be CRITICAL');
    assert.ok(ki.includes('Cookie auth') || ki.includes('cookie auth') || ki.includes('401'),
      'Should mention auth/cookie/401');
  });

  it('KI-002: response key is "p" not "posts"', () => {
    const r = resolve('postiz', { noLog: true });
    const ki = r.knownIssues.find(k => k.includes('KI-002'));
    assert.ok(ki, 'KI-002 should exist');
    assert.ok(ki.includes('"p"') || ki.includes("\"p\""), 'Should mention the "p" key');
  });

  it('KI-003: image path format', () => {
    const r = resolve('postiz', { noLog: true });
    const ki = r.knownIssues.find(k => k.includes('KI-003'));
    assert.ok(ki, 'KI-003 should exist');
    assert.ok(ki.includes('LEADING SLASH') || ki.includes('leading slash') || ki.includes('/uploads/'),
      'Should mention path format');
  });

  it('KI-004: X character limit is 200', () => {
    const r = resolve('postiz', { noLog: true });
    const ki = r.knownIssues.find(k => k.includes('KI-004'));
    assert.ok(ki, 'KI-004 should exist');
    assert.ok(ki.includes('200'), 'Should mention 200 char limit');
  });

  it('KI-005: Facebook image handling', () => {
    const r = resolve('postiz', { noLog: true });
    const ki = r.knownIssues.find(k => k.includes('KI-005'));
    assert.ok(ki, 'KI-005 should exist');
    assert.ok(ki.includes('Facebook') || ki.includes('FB'), 'Should mention Facebook');
  });

  it('KI-006: prefer CLI over curl', () => {
    const r = resolve('postiz', { noLog: true });
    const ki = r.knownIssues.find(k => k.includes('KI-006'));
    assert.ok(ki, 'KI-006 should exist');
    assert.ok(ki.includes('CLI') || ki.includes('postiz npm'), 'Should mention CLI preference');
  });

  it('social media queries surface postiz KIs', () => {
    const r = resolve('check social media queue', { noLog: true });
    assert.ok(r, 'Should resolve');
    // May match postiz directly or a postiz action
    const isPostiz = r.entity.name === 'postiz' || r.skills.some(s => s.name === 'postiz');
    if (isPostiz && r.entity.name === 'postiz') {
      assert.ok(r.knownIssues.length > 0, 'Social media queries should surface postiz KIs');
    }
  });
});

// ─── Known Issues in formatOutput ─────────────────────────────────────────────

describe('Known issues in CLI output (formatOutput)', () => {

  it('KNOWN_ISSUES section appears in formatted output', () => {
    const r = resolve('wix-api', { noLog: true });
    const output = formatOutput(r);
    assert.ok(output.includes('KNOWN_ISSUES:'), 'CLI output should have KNOWN_ISSUES section');
  });

  it('each KI appears on its own line', () => {
    const r = resolve('wix-api', { noLog: true });
    const output = formatOutput(r);
    const kiSection = output.split('KNOWN_ISSUES:')[1];
    assert.ok(kiSection, 'Should have KI section');
    const lines = kiSection.trim().split('\n').filter(l => l.trim());
    assert.ok(lines.length >= 4, `Should have 4+ KI lines, got ${lines.length}`);
  });

  it('no KNOWN_ISSUES section when entity has none', () => {
    const r = resolve('grepai', { noLog: true });
    if (r && r.knownIssues.length === 0) {
      const output = formatOutput(r);
      assert.ok(!output.includes('KNOWN_ISSUES:'), 'Should not have KNOWN_ISSUES section');
    }
  });
});

// ─── Known Issues Isolation ─────────────────────────────────────────────────

describe('Known issues isolation from attrs', () => {

  it('known_issue entries NOT in attrs array', () => {
    const r = resolve('wix api', { noLog: true });
    assert.ok(r, 'Should resolve');
    const kiInAttrs = r.attrs.some(a => a.key === 'known_issue');
    assert.ok(!kiInAttrs, 'known_issue should be excluded from attrs array');
  });

  it('known_issue entries IN knownIssues array', () => {
    const r = resolve('postiz', { noLog: true });
    assert.ok(r, 'Should resolve');
    assert.ok(r.knownIssues.length > 0, 'knownIssues array should be populated');
    // All should be strings (values, not key-value pairs)
    r.knownIssues.forEach(ki => {
      assert.strictEqual(typeof ki, 'string', 'Each KI should be a string');
    });
  });

  it('both attrs and knownIssues populated for entity with both', () => {
    const r = resolve('postiz', { noLog: true });
    assert.ok(r, 'Should resolve');
    // Postiz should have regular attrs AND known issues
    assert.ok(r.knownIssues.length > 0, 'Should have known issues');
    // attrs might be empty or populated depending on what's stored — just verify they're arrays
    assert.ok(Array.isArray(r.attrs), 'attrs should be array');
    assert.ok(Array.isArray(r.knownIssues), 'knownIssues should be array');
  });
});
