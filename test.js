/**
 * graph-db: Test all brainstormed use cases against the resolver.
 * Each test: query string → expected primary entity name.
 */

import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import resolve function by running query logic inline
const DB_PATH = join(__dirname, 'skillgraph.db');
const db = new Database(DB_PATH, { readonly: true });
db.pragma('foreign_keys = ON');

const STOPWORDS = new Set(['a', 'an', 'the', 'to', 'for', 'of', 'in', 'on', 'is', 'it', 'my', 'me', 'do', 'i', 'we', 'and', 'or', 'can', 'you', 'how', 'what', 'with', 'this', 'that']);

function resolve(taskDescription) {
  const task = taskDescription.toLowerCase().trim();
  const words = task.split(/\s+/).filter(w => !STOPWORDS.has(w) && w.length >= 2);
  const scores = new Map();

  const exactMatches = db.prepare(`SELECT e.*, a.alias FROM entities e JOIN aliases a ON a.entity_id = e.id WHERE a.alias = ?`).all(task);
  for (const m of exactMatches) scores.set(m.id, { entity: m, score: 100, matchType: 'exact_alias' });

  for (let len = words.length; len >= 2; len--) {
    for (let i = 0; i <= words.length - len; i++) {
      const phrase = words.slice(i, i + len).join(' ');
      const matches = db.prepare(`SELECT e.*, a.alias FROM entities e JOIN aliases a ON a.entity_id = e.id WHERE a.alias = ?`).all(phrase);
      for (const m of matches) {
        const existing = scores.get(m.id);
        const phraseScore = 50 + (len * 10);
        if (!existing || existing.score < phraseScore) scores.set(m.id, { entity: m, score: phraseScore, matchType: 'phrase_alias' });
      }
    }
  }

  for (const word of words) {
    const matches = db.prepare(`SELECT e.*, a.alias FROM entities e JOIN aliases a ON a.entity_id = e.id WHERE a.alias = ?`).all(word);
    for (const m of matches) {
      const existing = scores.get(m.id);
      const typeBoost = m.type === 'workflow' ? 5 : 0;
      const wordScore = 20 + typeBoost;
      if (!existing || existing.score < wordScore) scores.set(m.id, { entity: m, score: wordScore, matchType: 'word_alias' });
    }
  }

  for (const word of words) {
    if (word.length < 4) continue;
    const matches = db.prepare(`SELECT * FROM entities WHERE LOWER(name) LIKE ? OR LOWER(description) LIKE ?`).all(`%${word}%`, `%${word}%`);
    for (const m of matches) {
      if (!scores.has(m.id)) scores.set(m.id, { entity: m, score: 10, matchType: 'description' });
    }
  }

  if (scores.size === 0) return { match: 'none', primary: null };
  const ranked = [...scores.values()].sort((a, b) => b.score - a.score);
  const best = ranked[0];
  return {
    match: best.matchType,
    confidence: best.score >= 50 ? 'high' : best.score >= 20 ? 'medium' : 'low',
    primary: { name: best.entity.name, type: best.entity.type, score: best.score }
  };
}

// ========== TEST CASES ==========

const tests = [
  // komodo (Docker management)
  { query: 'check status of ollama', expect: ['komodo', 'ollama'], desc: 'komodo or ollama stack' },
  { query: 'restart scrapling', expect: ['komodo', 'scrapling'], desc: 'komodo or scrapling stack' },
  { query: 'deploy a new stack', expect: ['komodo', 'komodo-deploy'], desc: 'komodo or deploy action' },
  { query: 'stop postiz', expect: ['komodo', 'postiz-stack'], desc: 'komodo or postiz stack' },
  { query: 'what stacks are running', expect: ['komodo', 'komodo-list-stacks', 'komodo-check-state'], desc: 'komodo or list/check action' },
  { query: 'update n8n', expect: ['komodo', 'n8n-stack'], desc: 'komodo or n8n stack' },
  { query: 'check docker logs', expect: ['komodo'], desc: 'komodo' },

  // himalaya (email)
  { query: 'check my email', expect: ['himalaya'], desc: 'himalaya' },
  { query: 'read email from X', expect: ['himalaya'], desc: 'himalaya' },
  { query: 'reply to that email', expect: ['himalaya'], desc: 'himalaya' },
  { query: 'send an email to X', expect: ['himalaya', 'himalaya-send'], desc: 'himalaya' },
  { query: 'search inbox for X', expect: ['himalaya'], desc: 'himalaya' },
  { query: 'any unread messages', expect: ['himalaya'], desc: 'himalaya' },

  // caldav-calendar
  { query: "what's on my calendar", expect: ['caldav-calendar'], desc: 'caldav-calendar' },
  { query: 'any meetings today', expect: ['caldav-calendar'], desc: 'caldav-calendar' },
  { query: 'schedule something', expect: ['caldav-calendar'], desc: 'caldav-calendar' },
  { query: "check tomorrow's agenda", expect: ['caldav-calendar'], desc: 'caldav-calendar' },
  { query: 'sync calendar', expect: ['caldav-calendar'], desc: 'caldav-calendar' },

  // whisper-local: REMOVED — STT is now native OpenClaw (tools.media.audio)

  // wix-api
  { query: 'publish the blog post', expect: ['wix-api', 'Blog Post'], desc: 'wix-api or Blog Post' },
  { query: 'create a draft on wix', expect: ['wix-api'], desc: 'wix-api' },
  { query: 'upload blog image', expect: ['wix-api', 'Blog Post'], desc: 'wix-api or Blog Post' },
  { query: 'update the blog post', expect: ['wix-api', 'Blog Post'], desc: 'wix-api or Blog Post' },
  { query: 'delete the draft', expect: ['wix-api'], desc: 'wix-api' },

  // postiz
  { query: 'schedule a post', expect: ['postiz', 'Social Media Post', 'postiz-schedule-post'], desc: 'postiz or Social Media Post or schedule action' },
  { query: 'post to linkedin', expect: ['postiz'], desc: 'postiz' },
  { query: 'tweet this', expect: ['postiz'], desc: 'postiz' },
  { query: 'check failed posts', expect: ['postiz', 'postiz-list-posts'], desc: 'postiz' },
  { query: "what's in the postiz queue", expect: ['postiz', 'postiz-list-posts'], desc: 'postiz' },
  { query: 'post to bluesky', expect: ['postiz'], desc: 'postiz' },

  // nano-banana-pro
  { query: 'generate a blog header', expect: ['nano-banana-pro', 'blog-header-target', 'Image Generation'], desc: 'nano-banana-pro or image target' },
  { query: 'create an image for', expect: ['nano-banana-pro', 'Image Generation'], desc: 'nano-banana-pro or Image Generation' },
  { query: 'make an instagram post image', expect: ['nano-banana-pro', 'instagram-carousel-target', 'Image Generation'], desc: 'nano-banana-pro or image target' },
  { query: 'generate a cover image', expect: ['nano-banana-pro', 'Image Generation'], desc: 'nano-banana-pro or Image Generation' },

  // writing-quality
  { query: 'check this for AI detection', expect: ['writing-quality'], desc: 'writing-quality' },
  { query: 'run quality check', expect: ['writing-quality'], desc: 'writing-quality' },
  { query: 'is this readable', expect: ['writing-quality'], desc: 'writing-quality' },
  { query: 'check the writing', expect: ['writing-quality'], desc: 'writing-quality' },

  // gsc-seo
  { query: 'submit URL to google', expect: ['gsc-seo'], desc: 'gsc-seo' },
  { query: 'check indexing status', expect: ['gsc-seo'], desc: 'gsc-seo' },
  { query: 'SEO performance report', expect: ['gsc-seo'], desc: 'gsc-seo' },
  { query: 'any crawl errors', expect: ['gsc-seo'], desc: 'gsc-seo' },

  // wix-seo
  { query: 'update meta descriptions', expect: ['wix-seo'], desc: 'wix-seo' },
  { query: 'push SEO metadata', expect: ['wix-seo'], desc: 'wix-seo' },
  { query: 'set page titles', expect: ['wix-seo'], desc: 'wix-seo' },

  // summarize
  { query: 'summarize this URL', expect: ['summarize'], desc: 'summarize' },
  { query: 'summarize this PDF', expect: ['summarize'], desc: 'summarize' },
  { query: 'give me the key points', expect: ['summarize'], desc: 'summarize' },
  { query: 'TLDR', expect: ['summarize'], desc: 'summarize' },

  // github
  { query: 'check PR status', expect: ['github'], desc: 'github' },
  { query: 'create an issue', expect: ['github'], desc: 'github' },
  { query: 'list open PRs', expect: ['github'], desc: 'github' },
  { query: 'check CI', expect: ['github'], desc: 'github' },
  { query: 'merge the PR', expect: ['github'], desc: 'github' },

  // gh-issues
  { query: 'fix github issues', expect: ['gh-issues'], desc: 'gh-issues' },
  { query: 'work on open bugs', expect: ['gh-issues'], desc: 'gh-issues' },
  { query: 'auto-fix issues', expect: ['gh-issues'], desc: 'gh-issues' },

  // coding-agent
  { query: 'build a new feature', expect: ['coding-agent'], desc: 'coding-agent' },
  { query: 'refactor this code', expect: ['coding-agent', 'grepai-search'], desc: 'coding-agent' },
  { query: 'review the PR code', expect: ['coding-agent', 'github'], desc: 'coding-agent' },
  { query: 'create an app', expect: ['coding-agent'], desc: 'coding-agent' },

  // remarkable
  { query: 'sync remarkable', expect: ['remarkable'], desc: 'remarkable' },
  { query: 'upload to remarkable', expect: ['remarkable'], desc: 'remarkable' },
  { query: 'download my sketches', expect: ['remarkable'], desc: 'remarkable' },

  // healthkit-sync
  { query: 'check my steps', expect: ['healthkit-sync'], desc: 'healthkit-sync' },
  { query: 'sleep data', expect: ['healthkit-sync'], desc: 'healthkit-sync' },
  { query: 'heart rate', expect: ['healthkit-sync'], desc: 'healthkit-sync' },
  { query: 'health stats', expect: ['healthkit-sync'], desc: 'healthkit-sync' },

  // dont-hack-me
  { query: 'security audit', expect: ['dont-hack-me'], desc: 'dont-hack-me' },
  { query: 'check security', expect: ['dont-hack-me'], desc: 'dont-hack-me' },
  { query: 'harden the server', expect: ['dont-hack-me'], desc: 'dont-hack-me' },
  { query: 'run security scan', expect: ['dont-hack-me'], desc: 'dont-hack-me' },

  // soul-md
  { query: 'update my soul', expect: ['soul-md'], desc: 'soul-md' },
  { query: 'who are you', expect: ['soul-md'], desc: 'soul-md' },
  { query: 'change your personality', expect: ['soul-md'], desc: 'soul-md' },

  // otter
  { query: 'get meeting notes', expect: ['otter'], desc: 'otter' },
  { query: 'check otter transcripts', expect: ['otter'], desc: 'otter' },
  { query: 'meeting summary', expect: ['otter'], desc: 'otter' },

  // SuperDesign
  { query: 'design a landing page', expect: ['SuperDesign'], desc: 'SuperDesign' },
  { query: 'UI guidelines', expect: ['SuperDesign'], desc: 'SuperDesign' },
  { query: 'make it look good', expect: ['SuperDesign'], desc: 'SuperDesign' },

  // skill-graph-update
  { query: 'update the graph', expect: ['skill-graph-update'], desc: 'skill-graph-update' },
  { query: 'add a new skill', expect: ['skill-graph-update'], desc: 'skill-graph-update' },

  // Home Assistant
  { query: 'turn on the lights', expect: ['Home Assistant API'], desc: 'Home Assistant' },
  { query: 'set thermostat to 72', expect: ['Home Assistant API'], desc: 'Home Assistant' },

  // weather
  { query: 'what is the weather', expect: ['weather'], desc: 'weather' },
  { query: 'weather forecast', expect: ['weather'], desc: 'weather' },
  { query: 'is it going to rain', expect: ['weather'], desc: 'weather' },

  // goplaces
  { query: 'find a restaurant', expect: ['goplaces'], desc: 'goplaces' },
  { query: 'nearby coffee', expect: ['goplaces'], desc: 'goplaces' },
  { query: 'coffee shop near me', expect: ['goplaces'], desc: 'goplaces' },

  // apple-reminders
  { query: 'check reminders', expect: ['apple-reminders'], desc: 'apple-reminders' },
  { query: 'add to groceries', expect: ['apple-reminders'], desc: 'apple-reminders' },
  { query: 'grocery list', expect: ['apple-reminders'], desc: 'apple-reminders' },
  { query: 'remind me', expect: ['apple-reminders'], desc: 'apple-reminders' },
];

// ========== RUN TESTS ==========

let pass = 0;
let fail = 0;
const failures = [];

for (const t of tests) {
  const result = resolve(t.query);
  const got = result.primary?.name || 'NONE';
  const ok = t.expect.includes(got);
  
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push({
      query: t.query,
      expected: t.expect.join(' | '),
      got: got,
      score: result.primary?.score || 0,
      match: result.match
    });
  }
}

console.log(`\n🧪 Test Results: ${pass}/${pass + fail} passed (${fail} failed)\n`);

if (failures.length > 0) {
  console.log('❌ Failures:');
  console.log('─'.repeat(90));
  for (const f of failures) {
    console.log(`  Query:    "${f.query}"`);
    console.log(`  Expected: ${f.expected}`);
    console.log(`  Got:      ${f.got} (score: ${f.score}, match: ${f.match})`);
    console.log('─'.repeat(90));
  }
}

db.close();
