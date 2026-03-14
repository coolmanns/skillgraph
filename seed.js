/**
 * graph-db: Seed the knowledge graph — USE-CASE FIRST approach.
 * 
 * Every alias is a real thing Sascha would say or ask.
 * No artificial "workflow" buckets unless they represent real multi-step flows.
 * 
 * Real workflows (ordered steps): Blog Post, Social Media Post
 * Everything else: direct skill/tool routing
 */

import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'skillgraph.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Helpers ---

const insertEntity = db.prepare(`
  INSERT OR IGNORE INTO entities (type, name, description, emoji)
  VALUES (@type, @name, @description, @emoji)
`);

const insertEdge = db.prepare(`
  INSERT OR IGNORE INTO edges (source_id, target_id, relationship, step_order, mandatory, detail)
  VALUES (@source_id, @target_id, @relationship, @step_order, @mandatory, @detail)
`);

const insertAttr = db.prepare(`
  INSERT OR REPLACE INTO attrs (entity_id, key, value) VALUES (@entity_id, @key, @value)
`);

const insertAlias = db.prepare(`
  INSERT OR IGNORE INTO aliases (entity_id, alias) VALUES (@entity_id, @alias)
`);

const getEntity = db.prepare(`SELECT id FROM entities WHERE name = ?`);

function ensureEntity(data) {
  insertEntity.run(data);
  return getEntity.get(data.name)?.id;
}

function addEdge(sourceName, targetName, relationship, opts = {}) {
  const src = getEntity.get(sourceName)?.id;
  const tgt = getEntity.get(targetName)?.id;
  if (!src || !tgt) {
    console.warn(`⚠ Edge skipped: ${sourceName} → ${targetName} (missing entity)`);
    return;
  }
  insertEdge.run({
    source_id: src, target_id: tgt, relationship,
    step_order: opts.step ?? null, mandatory: opts.mandatory ? 1 : 0, detail: opts.detail ?? null
  });
}

function addAttr(entityName, key, value) {
  const id = getEntity.get(entityName)?.id;
  if (!id) return;
  insertAttr.run({ entity_id: id, key, value });
}

function addAlias(entityName, ...aliases) {
  const id = getEntity.get(entityName)?.id;
  if (!id) return;
  for (const alias of aliases) {
    insertAlias.run({ entity_id: id, alias: alias.toLowerCase() });
  }
}

// --- Seed ---

const seedAll = db.transaction(() => {

  // Wipe stale data so seed is always authoritative
  db.exec('DELETE FROM aliases');
  db.exec('DELETE FROM attrs');
  db.exec('DELETE FROM edges');
  db.exec('DELETE FROM entities');

  // =============================================
  //  REAL WORKFLOWS (multi-step, ordered)
  // =============================================

  ensureEntity({ type: 'workflow', name: 'Blog Post', description: 'Write and publish a blog post on adultintraining.us', emoji: '📝' });
  ensureEntity({ type: 'workflow', name: 'Social Media Post', description: 'Create and schedule social content across platforms', emoji: '📱' });
  ensureEntity({ type: 'workflow', name: 'Research', description: 'Find, extract, and condense information from the web', emoji: '🔬' });
  ensureEntity({ type: 'workflow', name: 'Image Generation', description: 'Generate images for blog, social, or print', emoji: '🖼️' });

  // =============================================
  //  SKILLS (each with real use-case aliases)
  // =============================================

  // --- komodo: Docker management ---
  ensureEntity({ type: 'skill', name: 'komodo', description: 'Docker stack management — deploy, stop, restart, inspect all stacks via Komodo', emoji: '🐉' });
  addAlias('komodo',
    'docker', 'container', 'stack', 'deploy',
    'check status of ollama', 'restart scrapling', 'deploy a new stack',
    'stop postiz', 'what stacks are running', 'update n8n',
    'check docker logs', 'ollama status', 'docker status',
    'restart docker', 'redeploy', 'stack status',
    'start ollama', 'stop ollama', 'check ollama',
    'start whisper', 'stop whisper', 'restart whisper',
    'check scrapling', 'start scrapling', 'stop scrapling',
    'check n8n', 'start n8n', 'stop n8n', 'restart n8n',
    'check postiz', 'start postiz', 'restart postiz',
    'container logs', 'docker logs'
  );
  addAttr('komodo', 'stacks', 'postiz, ollama, monitoring, ghost, traefik, llama-embed, openwebui, n8n, whisper, scrapling, llama-metabolism, grepai');
  addAttr('komodo', 'rule', 'Never use raw docker commands except read-only state checks');

  // --- himalaya: Email ---
  ensureEntity({ type: 'skill', name: 'himalaya', description: 'Email via IMAP/SMTP — read, write, reply, search inbox', emoji: '📧' });
  addAlias('himalaya',
    'email', 'inbox', 'mail', 'imap', 'smtp',
    'check my email', 'read email', 'reply to email',
    'send an email', 'search inbox', 'any unread messages',
    'unread emails', 'new emails', 'email from',
    'forward email', 'check mail'
  );

  // --- caldav-calendar: Calendar ---
  ensureEntity({ type: 'skill', name: 'caldav-calendar', description: 'iCloud calendar via vdirsyncer + khal', emoji: '📅' });
  addAlias('caldav-calendar',
    'calendar', 'khal', 'vdirsyncer', 'meetings', 'schedule', 'agenda',
    'what is on my calendar', 'any meetings today', 'schedule something',
    'check tomorrow', 'sync calendar', 'upcoming events',
    'next meeting', 'today agenda', 'weekly schedule',
    'calendar sync', 'appointments', 'tomorrow agenda',
    'check tomorrow agenda', 'tomorrow schedule'
  );

  // --- whisper-local: REMOVED — STT is now native OpenClaw (tools.media.audio on port 8085) ---

  // --- wix-api: Blog publishing ---
  ensureEntity({ type: 'skill', name: 'wix-api', description: 'Wix blog API — draft, upload images, publish posts', emoji: null });
  addAlias('wix-api',
    'wix', 'blog api', 'publish blog',
    'create a draft on wix', 'upload blog image',
    'update the blog post', 'delete the draft',
    'wix draft', 'publish to wix'
  );
  addAttr('wix-api', 'gotcha', 'PATCH does NOT update richContent — delete draft and recreate');
  addAttr('wix-api', 'image_src', '{"src": {"url": "<wixstatic URL>"}} not {"src": {"id": "..."}}');
  addAttr('wix-api', 'link_target', '"BLANK" not "_blank"');

  // --- postiz: Social scheduling ---
  ensureEntity({ type: 'skill', name: 'postiz', description: 'Social media scheduling to X, LinkedIn, Bluesky, Facebook', emoji: null });
  addAlias('postiz',
    'social scheduler', 'schedule post',
    'post to linkedin', 'tweet this', 'post to twitter',
    'post to bluesky', 'schedule to facebook', 'social media schedule',
    'promote on social', 'share on linkedin',
    'share on twitter', 'share on x', 'post to x',
    'social media', 'postiz tool'
  );
  addAttr('postiz', 'utm', '?utm_source=<platform>&utm_medium=social');
  addAttr('postiz', 'rule', 'NOTHING goes to Postiz without Sascha explicit approval');
  addAttr('postiz', 'env', 'POSTIZ_URL, POSTIZ_EMAIL, POSTIZ_PASSWORD');
  addAttr('postiz', 'auth', 'POST /api/auth/login {email, password, provider:"LOCAL"} → cookie to /tmp/postiz-cookies.txt');
  addAttr('postiz', 'gotcha', 'Cookie expires periodically — re-login on 401. Response key for posts is "p" not "posts".');
  addAttr('postiz', 'integrations_env', 'POSTIZ_X_ID, POSTIZ_LINKEDIN_ID, POSTIZ_BLUESKY_ID, POSTIZ_FB_ID');

  // --- postiz actions ---
  ensureEntity({ type: 'action', name: 'postiz-auth', description: 'Login to Postiz API (cookie-based)', emoji: null });
  addAttr('postiz-auth', 'method', 'POST');
  addAttr('postiz-auth', 'endpoint', '/api/auth/login');
  addAttr('postiz-auth', 'body', '{"email":"$POSTIZ_EMAIL","password":"$POSTIZ_PASSWORD","provider":"LOCAL"}');
  addAttr('postiz-auth', 'cookie_jar', '/tmp/postiz-cookies.txt');
  addAttr('postiz-auth', 'command', 'curl -s -c /tmp/postiz-cookies.txt "$POSTIZ_URL/api/auth/login" -H "Content-Type: application/json" -d \'{"email":"\'$POSTIZ_EMAIL\'","password":"\'$POSTIZ_PASSWORD\'","provider":"LOCAL"}\'');
  addAlias('postiz-auth', 'postiz login', 'login to postiz');

  ensureEntity({ type: 'action', name: 'postiz-list-posts', description: 'List posts by date range', emoji: null });
  addAttr('postiz-list-posts', 'method', 'GET');
  addAttr('postiz-list-posts', 'endpoint', '/api/posts?startDate={ISO}&endDate={ISO}');
  addAttr('postiz-list-posts', 'response_key', 'p');
  addAttr('postiz-list-posts', 'command', 'curl -s -b /tmp/postiz-cookies.txt "$POSTIZ_URL/api/posts?startDate=2025-01-01T00:00:00Z&endDate=2025-12-31T00:00:00Z"');
  addAttr('postiz-list-posts', 'states', 'QUEUE=scheduled, PUBLISHED=posted, ERROR=failed, DRAFT=saved');
  addAttr('postiz-list-posts', 'prereq', 'postiz-auth');
  addAttr('postiz-list-posts', 'script', 'bash ~/clawd/scripts/postiz-status.sh');
  addAlias('postiz-list-posts', 'list posts', 'post queue', 'scheduled posts', 'check queue',
    'social media queue', 'queue status', 'postiz status', 'postiz queue',
    'social media status', 'check postiz', 'postiz post status',
    'check failed posts', 'failed social posts', 'postiz errors',
    'check post queue', 'check social media queue', 'check postiz posts',
    'postiz post queue', 'what is in the postiz queue', 'postiz posts',
    'post status');

  ensureEntity({ type: 'action', name: 'postiz-schedule-post', description: 'Schedule a post to one or more platforms', emoji: null });
  addAttr('postiz-schedule-post', 'method', 'POST');
  addAttr('postiz-schedule-post', 'endpoint', '/api/posts');
  addAttr('postiz-schedule-post', 'body_template', '{"type":"schedule","date":"<ISO>","posts":[{"integration":{"id":"<INTEGRATION_ID>"},"value":[{"content":"<text>","image":[]}],"settings":{"__type":"<platform>"}}]}');
  addAttr('postiz-schedule-post', 'types', 'schedule=auto-publish at date, draft=save for review, now=publish immediately');
  addAttr('postiz-schedule-post', 'image_rule', 'Never leave image:[] — always attach. Upload first via postiz-upload-media.');
  addAttr('postiz-schedule-post', 'prereq', 'postiz-auth');
  addAlias('postiz-schedule-post', 'schedule a post', 'create post', 'new social post', 'queue a post');

  ensureEntity({ type: 'action', name: 'postiz-upload-media', description: 'Upload image for use in posts', emoji: null });
  addAttr('postiz-upload-media', 'method', 'POST');
  addAttr('postiz-upload-media', 'endpoint', '/api/media/upload-simple');
  addAttr('postiz-upload-media', 'content_type', 'multipart/form-data');
  addAttr('postiz-upload-media', 'command', 'curl -s -b /tmp/postiz-cookies.txt "$POSTIZ_URL/api/media/upload-simple" -F "file=@/path/to/image.jpg"');
  addAttr('postiz-upload-media', 'response', '{"id":"...","path":"/uploads/..."}');
  addAttr('postiz-upload-media', 'prereq', 'postiz-auth');
  addAlias('postiz-upload-media', 'upload social image', 'postiz upload', 'upload to postiz');

  ensureEntity({ type: 'action', name: 'postiz-delete-post', description: 'Delete a scheduled or draft post', emoji: null });
  addAttr('postiz-delete-post', 'method', 'DELETE');
  addAttr('postiz-delete-post', 'endpoint', '/api/posts/{POST_ID}');
  addAttr('postiz-delete-post', 'command', 'curl -s -b /tmp/postiz-cookies.txt -X DELETE "$POSTIZ_URL/api/posts/POST_ID"');
  addAttr('postiz-delete-post', 'prereq', 'postiz-auth');
  addAlias('postiz-delete-post', 'delete post', 'remove post', 'cancel scheduled post');

  ensureEntity({ type: 'action', name: 'postiz-list-integrations', description: 'List connected social media accounts', emoji: null });
  addAttr('postiz-list-integrations', 'method', 'GET');
  addAttr('postiz-list-integrations', 'endpoint', '/api/integrations/list');
  addAttr('postiz-list-integrations', 'response_key', 'integrations');
  addAttr('postiz-list-integrations', 'command', 'curl -s -b /tmp/postiz-cookies.txt "$POSTIZ_URL/api/integrations/list"');
  addAttr('postiz-list-integrations', 'prereq', 'postiz-auth');
  addAlias('postiz-list-integrations', 'connected accounts', 'social accounts', 'postiz integrations', 'which platforms');

  ensureEntity({ type: 'action', name: 'postiz-find-slot', description: 'Find next available posting slot for a channel', emoji: null });
  addAttr('postiz-find-slot', 'method', 'GET');
  addAttr('postiz-find-slot', 'endpoint', '/api/posts/find-slot/{INTEGRATION_ID}');
  addAttr('postiz-find-slot', 'command', 'curl -s -b /tmp/postiz-cookies.txt "$POSTIZ_URL/api/posts/find-slot/$POSTIZ_X_ID"');
  addAttr('postiz-find-slot', 'prereq', 'postiz-auth');
  addAlias('postiz-find-slot', 'next slot', 'find posting slot', 'when to post next', 'next available slot');

  // postiz → action edges
  addEdge('postiz', 'postiz-auth', 'provides', { detail: 'POST /api/auth/login → cookie' });
  addEdge('postiz', 'postiz-list-posts', 'provides', { detail: 'GET /api/posts?startDate=&endDate=' });
  addEdge('postiz', 'postiz-schedule-post', 'provides', { detail: 'POST /api/posts' });
  addEdge('postiz', 'postiz-upload-media', 'provides', { detail: 'POST /api/media/upload-simple' });
  addEdge('postiz', 'postiz-delete-post', 'provides', { detail: 'DELETE /api/posts/{id}' });
  addEdge('postiz', 'postiz-list-integrations', 'provides', { detail: 'GET /api/integrations/list' });
  addEdge('postiz', 'postiz-find-slot', 'provides', { detail: 'GET /api/posts/find-slot/{id}' });

  // --- nano-banana-pro: Image generation ---
  ensureEntity({ type: 'skill', name: 'nano-banana-pro', description: 'Image generation via ComfyUI/SDXL pipeline', emoji: '🎨' });
  addAlias('nano-banana-pro',
    'generate image', 'create image', 'image gen', 'comfyui', 'sdxl',
    'generate a blog header', 'create an image',
    'make an instagram post image', 'generate a cover image',
    'blog header image', 'header image', 'cover image',
    'generate picture', 'create picture'
  );

  // --- writing-quality: Quality gate ---
  ensureEntity({ type: 'skill', name: 'writing-quality', description: 'AI detection, readability, soul check — mandatory before publishing', emoji: null });
  addAlias('writing-quality',
    'quality check', 'ai detection', 'readability',
    'check this for ai detection', 'run quality check',
    'is this readable', 'check the writing',
    'writing quality', 'soul check', 'humanize text',
    'ai check', 'detection check'
  );
  addAttr('writing-quality', 'rule', 'MANDATORY before blog posts, LinkedIn posts, guides, ebooks');

  // --- gsc-seo: Google Search Console ---
  ensureEntity({ type: 'skill', name: 'gsc-seo', description: 'Google Search Console — submit URLs, check indexing, performance reports', emoji: null });
  addAlias('gsc-seo',
    'seo', 'search console', 'google search console',
    'submit url to google', 'check indexing status',
    'seo performance', 'crawl errors', 'google indexing',
    'index this page', 'seo report'
  );

  // --- wix-seo: Wix SEO metadata ---
  ensureEntity({ type: 'skill', name: 'wix-seo', description: 'Wix SEO metadata — bulk titles, descriptions, noindex', emoji: null });
  addAlias('wix-seo',
    'meta descriptions', 'push seo metadata',
    'set page titles', 'wix seo', 'update meta',
    'seo metadata', 'page titles', 'noindex'
  );

  // --- summarize: Content condensing ---
  ensureEntity({ type: 'skill', name: 'summarize', description: 'Summarize URLs, PDFs, audio, video into key points', emoji: null });
  addAlias('summarize',
    'summarize', 'summarize this', 'tldr', 'key points',
    'summarize this url', 'summarize this pdf',
    'give me the key points', 'condense this',
    'summary', 'recap'
  );

  // --- github: GitHub ops ---
  ensureEntity({ type: 'skill', name: 'github', description: 'GitHub ops — PRs, issues, CI, code review via gh CLI', emoji: null });
  addAlias('github',
    'gh', 'pull request', 'pr', 'issue', 'ci',
    'check pr status', 'create an issue', 'list open prs',
    'check ci', 'merge the pr', 'github issue',
    'open a pr', 'pr review', 'ci status',
    'github actions', 'workflow run', 'pr checks'
  );

  // --- gh-issues: Issue automation ---
  ensureEntity({ type: 'skill', name: 'gh-issues', description: 'Fetch GitHub issues, spawn sub-agents to fix and open PRs', emoji: null });
  addAlias('gh-issues',
    'fix github issues', 'work on open bugs',
    'auto fix issues', 'auto-fix issues', 'auto pr', 'issue bot',
    'fix bugs automatically', 'autofix issues'
  );

  // --- coding-agent: Dev sub-agent ---
  ensureEntity({ type: 'skill', name: 'coding-agent', description: 'Spawn sub-agent for building features, refactoring, PR review', emoji: null });
  addAlias('coding-agent',
    'build a feature', 'refactor', 'review the pr code',
    'create an app', 'code review', 'build this',
    'write the code', 'implement this', 'coding task',
    'spawn coder', 'delegate coding'
  );

  // --- remarkable: Tablet ---
  ensureEntity({ type: 'skill', name: 'remarkable', description: 'reMarkable tablet bidirectional sync and sketch enhancement', emoji: null });
  addAlias('remarkable',
    'remarkable', 'tablet', 'sync remarkable',
    'upload to remarkable', 'download my sketches',
    'remarkable sync', 'e-ink', 'remarkable tablet'
  );

  // --- healthkit-sync: Health data ---
  ensureEntity({ type: 'skill', name: 'healthkit-sync', description: 'iOS HealthKit — steps, sleep, heart rate via webhook', emoji: null });
  addAlias('healthkit-sync',
    'steps', 'sleep data', 'heart rate', 'health stats',
    'check my steps', 'health data', 'healthkit',
    'how did i sleep', 'fitness data', 'activity data'
  );
  addAttr('healthkit-sync', 'port', '8787');

  // --- dont-hack-me: Security ---
  ensureEntity({ type: 'skill', name: 'dont-hack-me', description: '14-point security audit and hardening', emoji: null });
  addAlias('dont-hack-me',
    'security audit', 'check security', 'harden the server',
    'run security scan', 'security check', 'hardening',
    'vulnerability scan', 'firewall check', 'ssh audit'
  );

  // --- soul-md: Identity ---
  ensureEntity({ type: 'skill', name: 'soul-md', description: 'Identity — SOUL.md, STYLE.md shapes all output', emoji: null });
  addAlias('soul-md',
    'update my soul', 'who are you', 'change personality',
    'change your personality', 'soul file', 'identity', 'style guide',
    'personality', 'soul', 'who am i talking to'
  );

  // --- otter: Meeting notes ---
  ensureEntity({ type: 'skill', name: 'otter', description: 'Otter.ai meeting transcription and summaries', emoji: null });
  addAlias('otter',
    'meeting notes', 'otter transcripts', 'meeting summary',
    'otter ai', 'meeting recording', 'call notes',
    'meeting transcript'
  );

  // --- SuperDesign: UI design ---
  ensureEntity({ type: 'skill', name: 'SuperDesign', description: 'Frontend/UI design guidelines for beautiful modern UIs', emoji: null });
  addAlias('SuperDesign',
    'design a landing page', 'ui guidelines', 'make it look good',
    'frontend design', 'ui design', 'landing page',
    'design guidelines', 'beautiful ui'
  );

  // --- skill-graph-update: Meta ---
  ensureEntity({ type: 'skill', name: 'skill-graph-update', description: 'Update GRAPH.md and skill documentation (GP-003)', emoji: null });
  addAlias('skill-graph-update',
    'update the graph', 'add a new skill', 'update graph',
    'skill graph', 'graph update'
  );

  // --- weather: Forecasts ---
  ensureEntity({ type: 'skill', name: 'weather', description: 'Weather forecasts via wttr.in or Open-Meteo', emoji: '🌤️' });
  addAlias('weather',
    'weather', 'forecast', 'temperature',
    'what is the weather', 'weather today', 'weather forecast',
    'is it going to rain', 'how cold is it', 'weather tomorrow',
    'current weather', 'weather this week'
  );
  addAttr('weather', 'location_default', 'South Elgin, IL');
  addAttr('weather', 'source', 'wttr.in or Open-Meteo (no API key needed)');

  // --- goplaces: Google Places ---
  ensureEntity({ type: 'skill', name: 'goplaces', description: 'Google Places API search — find restaurants, businesses, nearby places', emoji: '📍' });
  addAlias('goplaces',
    'places', 'nearby', 'restaurant',
    'find a restaurant', 'nearby coffee', 'find a place',
    'where to eat', 'coffee shop near me', 'gas station',
    'find nearby', 'places near me', 'google places',
    'directions to', 'find a store'
  );
  addAttr('goplaces', 'binary', '~/bin/goplaces');
  addAttr('goplaces', 'home_coords', '41.9942, -88.2923 (South Elgin, IL)');
  addAttr('goplaces', 'default_radius', '5000m');

  // --- apple-reminders: Reminders ---
  ensureEntity({ type: 'skill', name: 'apple-reminders', description: 'Apple Reminders — lists, tasks, groceries, personal items', emoji: '✅' });
  addAlias('apple-reminders',
    'reminders', 'reminder', 'todo', 'todos',
    'add a reminder', 'check reminders', 'grocery list',
    'groceries', 'shopping list', 'add to groceries',
    'remind me', 'task list', 'to do list',
    'birdhouse list', 'what do i need to buy'
  );
  addAttr('apple-reminders', 'lists', 'Reminders (personal), Groceries, Birdhouse (home/pets), Travel Essentials (IGNORE — reusable packing)');
  addAttr('apple-reminders', 'note', 'Requires macOS node (GBM4MacBook Air) — node does not currently support run');

  // =============================================
  //  DOCKER STACKS (managed by komodo)
  // =============================================

  ensureEntity({ type: 'stack', name: 'ollama', description: 'Local LLMs via ROCm GPU', emoji: null });
  ensureEntity({ type: 'stack', name: 'whisper', description: 'Local STT (faster-whisper-large-v3-turbo, CPU)', emoji: null });
  ensureEntity({ type: 'stack', name: 'scrapling', description: 'Adaptive web scraping (Playwright + anti-bot)', emoji: null });
  ensureEntity({ type: 'stack', name: 'n8n-stack', description: 'Workflow automation platform', emoji: null });
  ensureEntity({ type: 'stack', name: 'postiz-stack', description: 'Social media scheduler (Temporal + ES, 7 services)', emoji: null });
  ensureEntity({ type: 'stack', name: 'monitoring', description: 'Grafana + Prometheus + Uptime Kuma', emoji: null });
  ensureEntity({ type: 'stack', name: 'ghost', description: 'Ghost CMS + MySQL', emoji: null });
  ensureEntity({ type: 'stack', name: 'llama-embed', description: 'GPU embedding server (nomic-embed, ROCm)', emoji: null });
  ensureEntity({ type: 'stack', name: 'llama-metabolism', description: 'Qwen3-14B for metabolism processing (ROCm)', emoji: null });
  ensureEntity({ type: 'stack', name: 'openwebui', description: 'Ollama web UI', emoji: null });
  ensureEntity({ type: 'stack', name: 'traefik', description: 'Reverse proxy (TLS, Let\'s Encrypt)', emoji: null });
  ensureEntity({ type: 'stack', name: 'grepai-stack', description: 'Semantic codebase search via nomic-embed', emoji: null });

  // Stack attributes
  addAttr('ollama', 'port', '11434');
  addAttr('ollama', 'gpu', 'AMD Radeon 8060S (ROCm)');
  addAttr('whisper', 'port', '8085');
  addAttr('whisper', 'model', 'faster-whisper-large-v3-turbo');
  addAttr('whisper', 'compute', 'CPU');
  addAttr('n8n-stack', 'port', '5678');
  addAttr('postiz-stack', 'port', '4007');
  addAttr('postiz-stack', 'services', '7');
  addAttr('monitoring', 'ports', '3001 (Grafana), 3003 (Uptime Kuma), 9090 (Prometheus)');
  addAttr('ghost', 'port', '2368');
  addAttr('llama-embed', 'port', '8082');
  addAttr('llama-embed', 'model', 'nomic-embed-text');
  addAttr('llama-embed', 'gpu', 'AMD Radeon 8060S (ROCm)');
  addAttr('llama-metabolism', 'port', '8084');
  addAttr('llama-metabolism', 'model', 'Qwen3-14B');
  addAttr('llama-metabolism', 'gpu', 'AMD Radeon 8060S (ROCm)');
  addAttr('openwebui', 'port', '3000');
  addAttr('traefik', 'ports', '80, 443');
  addAttr('grepai-stack', 'port', '8082');

  // Stack aliases
  addAlias('ollama', 'ollama', 'llm server', 'local llm', 'ollama status');
  addAlias('whisper', 'whisper stack', 'stt stack', 'whisper container');
  addAlias('scrapling', 'scrapling', 'scraper stack', 'web scraper stack');
  addAlias('n8n-stack', 'n8n', 'n8n stack', 'workflow engine');
  addAlias('postiz-stack', 'postiz stack', 'postiz container', 'social scheduler stack');
  addAlias('monitoring', 'monitoring', 'grafana', 'prometheus', 'uptime kuma', 'monitoring stack');
  addAlias('ghost', 'ghost', 'ghost cms', 'ghost stack');
  addAlias('llama-embed', 'llama embed', 'embedding server', 'nomic embed', 'embedding stack');
  addAlias('llama-metabolism', 'llama metabolism', 'metabolism model', 'qwen');
  addAlias('openwebui', 'open webui', 'openwebui', 'ollama ui', 'chat ui');
  addAlias('traefik', 'traefik', 'reverse proxy', 'ssl', 'lets encrypt');
  addAlias('grepai-stack', 'grepai', 'grep ai', 'code search', 'semantic search');

  // komodo → stack edges (manages relationship)
  addEdge('komodo', 'ollama', 'manages', { detail: 'Local LLMs, port 11434, GPU' });
  addEdge('komodo', 'whisper', 'manages', { detail: 'Local STT, port 8085, CPU' });
  addEdge('komodo', 'scrapling', 'manages', { detail: 'Web scraping, no exposed port' });
  addEdge('komodo', 'n8n-stack', 'manages', { detail: 'Workflow automation, port 5678' });
  addEdge('komodo', 'postiz-stack', 'manages', { detail: 'Social scheduler, port 4007, 7 services' });
  addEdge('komodo', 'monitoring', 'manages', { detail: 'Grafana/Prometheus/Uptime Kuma' });
  addEdge('komodo', 'ghost', 'manages', { detail: 'Ghost CMS, port 2368' });
  addEdge('komodo', 'llama-embed', 'manages', { detail: 'Embedding server, port 8082, GPU' });
  addEdge('komodo', 'llama-metabolism', 'manages', { detail: 'Metabolism LLM, port 8084, GPU' });
  addEdge('komodo', 'openwebui', 'manages', { detail: 'Ollama web UI, port 3000' });
  addEdge('komodo', 'traefik', 'manages', { detail: 'Reverse proxy, ports 80/443' });
  addEdge('komodo', 'grepai-stack', 'manages', { detail: 'Code search, port 8082' });

  // stack → komodo edges (managed_by relationship, for reverse traversal)
  addEdge('ollama', 'komodo', 'managed_by', { detail: 'Use komodo to start/stop/restart' });
  addEdge('whisper', 'komodo', 'managed_by', { detail: 'Use komodo to start/stop/restart' });
  addEdge('scrapling', 'komodo', 'managed_by', { detail: 'Use komodo to start/stop/restart' });
  addEdge('n8n-stack', 'komodo', 'managed_by', { detail: 'Use komodo to start/stop/restart' });
  addEdge('postiz-stack', 'komodo', 'managed_by', { detail: 'Use komodo to start/stop/restart' });
  addEdge('monitoring', 'komodo', 'managed_by', { detail: 'Use komodo to start/stop/restart' });
  addEdge('ghost', 'komodo', 'managed_by', { detail: 'Use komodo to start/stop/restart' });
  addEdge('llama-embed', 'komodo', 'managed_by', { detail: 'Use komodo to start/stop/restart' });
  addEdge('llama-metabolism', 'komodo', 'managed_by', { detail: 'Use komodo to start/stop/restart' });
  addEdge('openwebui', 'komodo', 'managed_by', { detail: 'Use komodo to start/stop/restart' });
  addEdge('traefik', 'komodo', 'managed_by', { detail: 'Use komodo to start/stop/restart' });
  addEdge('grepai-stack', 'komodo', 'managed_by', { detail: 'Use komodo to start/stop/restart' });

  // =============================================
  //  KOMODO API ACTIONS (what you can do)
  // =============================================

  ensureEntity({ type: 'action', name: 'komodo-list-stacks', description: 'List all Docker stacks and their status', emoji: null });
  ensureEntity({ type: 'action', name: 'komodo-deploy', description: 'Start or restart a Docker stack (pulls images, brings up)', emoji: null });
  ensureEntity({ type: 'action', name: 'komodo-stop', description: 'Stop all containers in a stack', emoji: null });
  ensureEntity({ type: 'action', name: 'komodo-destroy', description: 'Stop and remove containers (keeps config)', emoji: null });
  ensureEntity({ type: 'action', name: 'komodo-get-stack', description: 'Get detailed config and runtime info for a stack', emoji: null });
  ensureEntity({ type: 'action', name: 'komodo-check-state', description: 'Check live container state (fallback: docker ps)', emoji: null });

  addAttr('komodo-list-stacks', 'endpoint', 'POST /read/ListStacks');
  addAttr('komodo-list-stacks', 'body', '{}');
  addAttr('komodo-deploy', 'endpoint', 'POST /execute/DeployStack');
  addAttr('komodo-deploy', 'body', '{"stack": "<stack-name>"}');
  addAttr('komodo-stop', 'endpoint', 'POST /execute/StopStack');
  addAttr('komodo-stop', 'body', '{"stack": "<stack-name>"}');
  addAttr('komodo-destroy', 'endpoint', 'POST /execute/DestroyStack');
  addAttr('komodo-destroy', 'body', '{"stack": "<stack-name>"}');
  addAttr('komodo-get-stack', 'endpoint', 'POST /read/GetStack');
  addAttr('komodo-get-stack', 'body', '{"stack": "<stack-name>"}');
  addAttr('komodo-check-state', 'command', 'docker ps -a --filter name=<container> --format "{{.Names}}\\t{{.Status}}\\t{{.State}}"');
  addAttr('komodo-check-state', 'note', 'Read-only docker fallback when Komodo GetStack lacks live state');

  addAlias('komodo-list-stacks', 'list stacks', 'what stacks are running', 'stack list', 'all stacks', 'list containers');
  addAlias('komodo-deploy', 'start stack', 'restart stack', 'deploy stack', 'redeploy stack', 'bring up');
  addAlias('komodo-stop', 'stop stack', 'shut down stack', 'stop container');
  addAlias('komodo-destroy', 'destroy stack', 'remove stack', 'tear down stack');
  addAlias('komodo-get-stack', 'stack info', 'stack details', 'stack config', 'inspect stack');
  addAlias('komodo-check-state', 'check status', 'container status', 'is it running', 'stack status', 'running status');

  // komodo → action edges
  addEdge('komodo', 'komodo-list-stacks', 'provides', { detail: 'POST /read/ListStacks' });
  addEdge('komodo', 'komodo-deploy', 'provides', { detail: 'POST /execute/DeployStack' });
  addEdge('komodo', 'komodo-stop', 'provides', { detail: 'POST /execute/StopStack' });
  addEdge('komodo', 'komodo-destroy', 'provides', { detail: 'POST /execute/DestroyStack' });
  addEdge('komodo', 'komodo-get-stack', 'provides', { detail: 'POST /read/GetStack' });
  addEdge('komodo', 'komodo-check-state', 'provides', { detail: 'Read-only docker fallback' });

  // =============================================
  //  TOOLS (no SKILL.md, but used by workflows)
  // =============================================

  ensureEntity({ type: 'tool', name: 'Brave API', description: 'Web search — 1 req/sec rate limit', emoji: null });
  ensureEntity({ type: 'tool', name: 'Scrapling', description: 'Anti-bot deep web extraction (Docker via Komodo)', emoji: null });
  ensureEntity({ type: 'tool', name: 'message', description: 'Send messages via Telegram, Discord', emoji: null });
  ensureEntity({ type: 'tool', name: 'grepai', description: 'Semantic codebase search via nomic-embed', emoji: null });
  ensureEntity({ type: 'tool', name: 'n8n', description: 'Workflow automation platform', emoji: null });

  addAlias('Brave API', 'web search', 'brave search', 'search the web');
  addAlias('Scrapling', 'scrape', 'extract webpage', 'web scraper');
  addAlias('message', 'send message', 'telegram', 'discord message');
  addAlias('grepai', 'search code', 'codebase search', 'grep ai', 'semantic search');
  addAlias('n8n', 'workflow automation', 'n8n workflow', 'automation');

  addAttr('Brave API', 'rate_limit', '1 req/sec — always sleep 1 between calls');
  addAttr('grepai', 'port', '8082');

  // =============================================
  //  IMAGE TARGETS (sub-nodes of nano-banana-pro)
  // =============================================

  ensureEntity({ type: 'target', name: 'blog-header-target', description: 'Blog header image — 1200×630 JPEG', emoji: null });
  ensureEntity({ type: 'target', name: 'instagram-carousel-target', description: 'Instagram carousel — 1080×1080 PNG', emoji: null });
  ensureEntity({ type: 'target', name: 'print-target', description: 'Print publishing — 4K, 300 DPI, CMYK', emoji: null });

  addAlias('blog-header-target', 'blog header', 'blog image', '1200x630');
  addAlias('instagram-carousel-target', 'instagram image', 'carousel image', '1080x1080', 'instagram');
  addAlias('print-target', 'print image', 'high res image', '4k image', 'print quality');

  addAttr('blog-header-target', 'format', 'JPEG');
  addAttr('blog-header-target', 'resolution', '1200x630');
  addAttr('instagram-carousel-target', 'format', 'PNG');
  addAttr('instagram-carousel-target', 'resolution', '1080x1080');
  addAttr('print-target', 'format', 'CMYK');
  addAttr('print-target', 'resolution', '4K');
  addAttr('print-target', 'dpi', '300');

  // =============================================
  //  SITES
  // =============================================

  ensureEntity({ type: 'site', name: 'adultintraining.us', description: 'Psychedelic integration coaching — Wix hosted', emoji: null });
  ensureEntity({ type: 'site', name: 'microdose-tracker.com', description: 'Microdose tracking — Next.js + PostgreSQL on VPS', emoji: null });

  addAlias('adultintraining.us', 'adult in training', 'ait', 'coaching site');
  addAlias('microdose-tracker.com', 'microdose tracker', 'tracker');

  addAttr('adultintraining.us', 'platform', 'Wix');
  addAttr('adultintraining.us', 'url', 'https://www.adultintraining.us');
  addAttr('microdose-tracker.com', 'platform', 'Next.js + PostgreSQL');
  addAttr('microdose-tracker.com', 'server', '164.68.104.112');

  // =============================================
  //  PLATFORMS
  // =============================================

  ensureEntity({ type: 'platform', name: 'X', description: 'Twitter/X — ≤280 chars', emoji: null });
  ensureEntity({ type: 'platform', name: 'LinkedIn', description: 'Professional network — no hashtags', emoji: null });
  ensureEntity({ type: 'platform', name: 'Bluesky', description: 'Bluesky — ≤300 chars', emoji: null });
  ensureEntity({ type: 'platform', name: 'Facebook', description: 'Facebook page', emoji: null });

  addAttr('X', 'char_limit', '280');
  addAttr('Bluesky', 'char_limit', '300');
  addAttr('LinkedIn', 'no_hashtags', 'true');

  // =============================================
  //  APIs
  // =============================================

  ensureEntity({ type: 'api', name: 'Wix API', description: 'https://www.wixapis.com/', emoji: null });
  ensureEntity({ type: 'api', name: 'Home Assistant API', description: 'Smart home control — lights, switches, climate, covers, media', emoji: null });
  
  addAlias('Home Assistant API', 'home assistant', 'lights', 'turn on lights', 'turn off lights', 'thermostat', 'smart home', 'home automation');
  addAttr('Home Assistant API', 'url', 'https://homeassistant.home.mykuhlmann.com/api/');
  addAttr('Home Assistant API', 'devices', '29 lights, 130 switches, 4 climate, 7 covers, 12 media players');

  // =============================================
  //  BLOG POST: Rich entity with full context
  // =============================================

  // Blog Post attributes (the knowledge it carries)
  addAttr('Blog Post', 'image_format', 'JPEG');
  addAttr('Blog Post', 'image_resolution', '1200x630');
  addAttr('Blog Post', 'image_max_size', '2MB');
  addAttr('Blog Post', 'image_rule', 'Always resize BEFORE publishing to Wix');
  addAttr('Blog Post', 'cta_standard', 'Divider + centered H2 + pitch + bold link to /book-online');
  addAttr('Blog Post', 'quality_rule', 'MANDATORY writing-quality check before publish');
  addAttr('Blog Post', 'utm_pattern', '?utm_source=<platform>&utm_medium=social');
  addAttr('Blog Post', 'social_rule', 'NOTHING goes to Postiz without Sascha explicit approval');
  addAttr('Blog Post', 'publish_target', 'adultintraining.us (Wix)');

  // Blog Post workflow edges (ordered steps with rich detail)
  addEdge('Blog Post', 'Brave API', 'uses', { step: 1, detail: 'Discover sources via web search' });
  addEdge('Blog Post', 'Scrapling', 'uses', { step: 1, detail: 'Extract full content from URLs (anti-bot)' });
  addEdge('Blog Post', 'summarize', 'uses', { step: 1, detail: 'Condense research into key points' });
  addEdge('Blog Post', 'writing-quality', 'requires', { step: 3, mandatory: true, detail: 'AI detection + readability + soul check. Do NOT skip.' });
  addEdge('Blog Post', 'nano-banana-pro', 'generates_image_via', { step: 4, detail: 'Generate cover image. Use blog-header-target: 1200×630 JPEG, <2MB. Resize before upload.' });
  addEdge('Blog Post', 'blog-header-target', 'image_spec', { step: 4, detail: '1200×630 JPEG, max 2MB' });
  addEdge('Blog Post', 'wix-api', 'publishes_via', { step: 5, detail: 'Create draft → upload image to CDN → publish. GOTCHA: PATCH does NOT update richContent — delete draft and recreate. Image src: {"src":{"url":"<wixstatic URL>"}}. Link target: "BLANK" not "_blank".' });
  addEdge('Blog Post', 'postiz', 'promotes_via', { step: 6, detail: 'Schedule to X (≤280), LinkedIn (no hashtags), Bluesky (≤300), Facebook. UTM: ?utm_source=<platform>&utm_medium=social. MUST get Sascha approval first.' });
  addEdge('Blog Post', 'gsc-seo', 'indexes_via', { step: 7, detail: 'Submit published URL to Google Search Console for indexing' });
  addEdge('Blog Post', 'wix-seo', 'optimizes_via', { step: 7, detail: 'Push SEO metadata — title, description to Wix' });
  addEdge('Blog Post', 'adultintraining.us', 'publishes_to', { detail: 'Target site for all blog content' });

  // =============================================
  //  SOCIAL MEDIA POST: Rich entity with platform rules
  // =============================================

  addAttr('Social Media Post', 'approval_rule', 'NOTHING goes to Postiz without Sascha explicit approval');
  addAttr('Social Media Post', 'image_rule', 'Always attach images directly — link previews unreliable on LinkedIn/X');
  addAttr('Social Media Post', 'utm_pattern', '?utm_source=<platform>&utm_medium=social (no campaign unless actual campaign)');
  addAttr('Social Media Post', 'promote_rule', 'ONLY promote what is already LIVE — no teasers, no "coming soon"');

  addEdge('Social Media Post', 'nano-banana-pro', 'generates_image_via', { step: 1, detail: 'Generate image if needed. Format depends on platform: blog-header for link shares, instagram-carousel for IG.' });
  addEdge('Social Media Post', 'writing-quality', 'requires', { step: 2, mandatory: true, detail: 'Required for LinkedIn and long-form. X ≤280 chars can skip.' });
  addEdge('Social Media Post', 'postiz', 'schedules_via', { step: 3, detail: 'Schedule with platform-specific formatting + UTM links. Get Sascha approval first.' });
  addEdge('Social Media Post', 'X', 'publishes_to', { detail: '≤280 chars total. Short, punchy.' });
  addEdge('Social Media Post', 'LinkedIn', 'publishes_to', { detail: 'No hashtags. Professional tone. Image required for visibility.' });
  addEdge('Social Media Post', 'Bluesky', 'publishes_to', { detail: '≤300 chars total.' });
  addEdge('Social Media Post', 'Facebook', 'publishes_to', { detail: 'Standard format, image recommended.' });

  // =============================================
  //  WORKFLOW EDGES: Research
  // =============================================

  addEdge('Research', 'Brave API', 'uses', { step: 1, detail: 'Discover sources' });
  addEdge('Research', 'Scrapling', 'uses', { step: 2, detail: 'Anti-bot deep extraction' });
  addEdge('Research', 'summarize', 'uses', { step: 3, detail: 'Condense findings' });
  // whisper-local edge removed — STT is native OpenClaw now

  // =============================================
  //  WORKFLOW EDGES: Image Generation
  // =============================================

  addEdge('Image Generation', 'nano-banana-pro', 'uses', { detail: 'Core generation engine' });
  addEdge('Image Generation', 'blog-header-target', 'uses', { detail: '1200×630 JPEG for blogs' });
  addEdge('Image Generation', 'instagram-carousel-target', 'uses', { detail: '1080×1080 PNG for Instagram' });
  addEdge('Image Generation', 'print-target', 'uses', { detail: '4K, 300 DPI for print' });

  // =============================================
  //  CROSS-CUTTING EDGES
  // =============================================

  addEdge('nano-banana-pro', 'wix-api', 'feeds', { detail: 'CDN upload for blog images' });
  addEdge('nano-banana-pro', 'postiz', 'feeds', { detail: 'Social images' });
  addEdge('nano-banana-pro', 'remarkable', 'feeds', { detail: 'Sketch enhancement' });
  addEdge('gsc-seo', 'wix-api', 'monitors', { detail: 'Everything wix-api publishes' });
  addEdge('wix-api', 'Wix API', 'uses', { detail: 'Backend API' });
  addEdge('postiz', 'X', 'publishes_to', {});
  addEdge('postiz', 'LinkedIn', 'publishes_to', {});
  addEdge('postiz', 'Bluesky', 'publishes_to', {});
  addEdge('postiz', 'Facebook', 'publishes_to', {});
  addEdge('komodo', 'Scrapling', 'manages', { detail: 'Docker stack' });
  addEdge('komodo', 'n8n', 'manages', { detail: 'Docker stack' });
  addEdge('komodo', 'grepai', 'manages', { detail: 'Docker stack' });

  // =============================================
  //  WORKFLOW ALIASES (use cases people actually say)
  // =============================================

  addAlias('Blog Post',
    'blog', 'blog post', 'write blog', 'publish blog', 'article',
    'write article', 'write a blog post', 'new blog post',
    'draft a blog', 'blog draft'
  );
  addAlias('Social Media Post',
    'social post', 'social media', 'linkedin post', 'schedule social',
    'create a social post', 'social content', 'promote this'
  );
  addAlias('Research',
    'research', 'look up', 'find information', 'research this',
    'dig into', 'investigate'
  );
  addAlias('Image Generation',
    'generate image', 'create image', 'make image', 'picture',
    'photo', 'image for', 'cover image', 'header image'
  );
});

seedAll();

// Stats
const entityCount = db.prepare('SELECT COUNT(*) as c FROM entities').get().c;
const edgeCount = db.prepare('SELECT COUNT(*) as c FROM edges').get().c;
const aliasCount = db.prepare('SELECT COUNT(*) as c FROM aliases').get().c;
const attrCount = db.prepare('SELECT COUNT(*) as c FROM attrs').get().c;

console.log(`✅ skillgraph.db seeded:`);
console.log(`   ${entityCount} entities, ${edgeCount} edges, ${aliasCount} aliases, ${attrCount} attributes`);

db.close();
