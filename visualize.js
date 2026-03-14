/**
 * graph-db visualizer: Serves an interactive force-directed graph of skillgraph.db
 * Uses D3.js for rendering. Run: node visualize.js [port]
 */

import Database from 'better-sqlite3';
import { createServer } from 'http';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'skillgraph.db');
const PORT = parseInt(process.argv[2] || '8099');

function getGraphData() {
  const db = new Database(DB_PATH, { readonly: true });
  
  const entities = db.prepare(`
    SELECT e.id, e.type, e.name, e.description, e.emoji
    FROM entities e ORDER BY e.id
  `).all();

  const edges = db.prepare(`
    SELECT ed.source_id, ed.target_id, ed.relationship, ed.step_order, ed.mandatory, ed.detail
    FROM edges ed
  `).all();

  const attrs = db.prepare(`SELECT entity_id, key, value FROM attrs`).all();
  const aliases = db.prepare(`SELECT entity_id, alias FROM aliases`).all();

  db.close();

  // Group attrs and aliases by entity
  const attrMap = {};
  for (const a of attrs) {
    if (!attrMap[a.entity_id]) attrMap[a.entity_id] = [];
    attrMap[a.entity_id].push({ key: a.key, value: a.value });
  }
  const aliasMap = {};
  for (const a of aliases) {
    if (!aliasMap[a.entity_id]) aliasMap[a.entity_id] = [];
    aliasMap[a.entity_id].push(a.alias);
  }

  const nodes = entities.map(e => ({
    id: e.id,
    name: e.emoji ? `${e.emoji} ${e.name}` : e.name,
    rawName: e.name,
    type: e.type,
    description: e.description || '',
    // skill_path removed
    attributes: attrMap[e.id] || [],
    aliases: aliasMap[e.id] || []
  }));

  const links = edges.map(e => ({
    source: e.source_id,
    target: e.target_id,
    relationship: e.relationship,
    step: e.step_order,
    mandatory: !!e.mandatory,
    detail: e.detail || ''
  }));

  return { nodes, links };
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>skillgraph.db — Knowledge Graph Viewer</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0f; color: #e0e0e0; font-family: 'SF Mono', 'Consolas', monospace; overflow: hidden; }
  
  #controls {
    position: fixed; top: 12px; left: 12px; z-index: 10;
    background: rgba(15,15,25,0.92); border: 1px solid #333; border-radius: 8px;
    padding: 12px 16px; font-size: 12px; max-width: 320px;
    backdrop-filter: blur(8px);
  }
  #controls h2 { font-size: 14px; margin-bottom: 8px; color: #88f; }
  #controls .stats { color: #888; margin-bottom: 8px; }
  #controls label { display: block; margin: 4px 0; cursor: pointer; }
  #controls input[type=checkbox] { margin-right: 6px; }
  #search { width: 100%; padding: 6px 8px; background: #1a1a2e; border: 1px solid #444; 
    color: #e0e0e0; border-radius: 4px; margin-bottom: 8px; font-family: inherit; }
  #search:focus { outline: none; border-color: #88f; }
  .filter-row { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
  .filter-btn { padding: 3px 8px; border-radius: 3px; border: 1px solid #444; background: transparent;
    color: #aaa; cursor: pointer; font-size: 11px; font-family: inherit; }
  .filter-btn.active { border-color: currentColor; color: var(--color); background: rgba(255,255,255,0.05); }

  #detail {
    position: fixed; top: 12px; right: 12px; z-index: 10;
    background: rgba(15,15,25,0.95); border: 1px solid #333; border-radius: 8px;
    padding: 16px; font-size: 12px; max-width: 380px; max-height: 80vh;
    overflow-y: auto; display: none; backdrop-filter: blur(8px);
  }
  #detail h3 { font-size: 15px; margin-bottom: 6px; }
  #detail .type-badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 10px;
    text-transform: uppercase; margin-bottom: 8px; }
  #detail .desc { color: #aaa; margin-bottom: 10px; }
  #detail .section { margin-bottom: 10px; }
  #detail .section-title { color: #88f; font-size: 11px; text-transform: uppercase; margin-bottom: 4px; }
  #detail .attr { color: #ccc; }
  #detail .attr .key { color: #f8a; }
  #detail .alias-list { color: #8a8; font-size: 11px; line-height: 1.6; }
  #detail .edge-item { padding: 3px 0; border-bottom: 1px solid #1a1a2e; }
  #detail .edge-rel { color: #fa8; font-size: 11px; }
  #detail .edge-target { color: #8af; }
  #detail .edge-detail { color: #888; font-size: 11px; }
  #detail .mandatory { color: #f55; font-weight: bold; }
  
  svg { width: 100vw; height: 100vh; }
  .link { stroke-opacity: 0.35; fill: none; }
  .link.mandatory { stroke-opacity: 0.7; stroke-dasharray: none; }
  .link-label { font-size: 9px; fill: #666; pointer-events: none; }
  .node circle { stroke-width: 1.5; cursor: pointer; }
  .node circle:hover { stroke-width: 3; }
  .node text { font-size: 10px; fill: #ccc; pointer-events: none; }
  .node.dimmed circle { opacity: 0.15; }
  .node.dimmed text { opacity: 0.1; }
  .link.dimmed { stroke-opacity: 0.05; }
  .link-label.dimmed { opacity: 0.05; }
</style>
</head>
<body>

<div id="controls">
  <h2>🧠 skillgraph.db</h2>
  <div class="stats" id="stats"></div>
  <input type="text" id="search" placeholder="Search entities...">
  <div class="filter-row" id="filters"></div>
  <label><input type="checkbox" id="showLabels" checked> Edge labels</label>
  <label><input type="checkbox" id="showAliases"> Show aliases on hover</label>
</div>

<div id="detail"></div>

<svg id="graph"></svg>

<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
const TYPE_COLORS = {
  workflow: '#6688ff',
  skill: '#44cc88',
  tool: '#ccaa44',
  stack: '#cc6644',
  action: '#cc44aa',
  target: '#44aacc',
  site: '#aa66cc',
  platform: '#66cccc',
  api: '#cc8844',
  device: '#88aa44'
};

const TYPE_SIZES = {
  workflow: 18,
  skill: 12,
  tool: 9,
  stack: 9,
  action: 7,
  target: 7,
  site: 10,
  platform: 8,
  api: 8,
  device: 8
};

let data, simulation, svg, g, link, linkLabel, node;
let activeTypes = new Set(Object.keys(TYPE_COLORS));
let searchTerm = '';
let selectedNode = null;

async function init() {
  const resp = await fetch('/api/graph');
  data = await resp.json();
  
  document.getElementById('stats').textContent = 
    data.nodes.length + ' entities · ' + data.links.length + ' edges';

  // Build filter buttons
  const types = [...new Set(data.nodes.map(n => n.type))].sort();
  const filterDiv = document.getElementById('filters');
  for (const t of types) {
    const btn = document.createElement('button');
    btn.className = 'filter-btn active';
    btn.textContent = t + ' (' + data.nodes.filter(n => n.type === t).length + ')';
    btn.style.setProperty('--color', TYPE_COLORS[t] || '#888');
    btn.style.color = TYPE_COLORS[t] || '#888';
    btn.dataset.type = t;
    btn.onclick = () => {
      if (activeTypes.has(t)) { activeTypes.delete(t); btn.classList.remove('active'); }
      else { activeTypes.add(t); btn.classList.add('active'); }
      updateVisibility();
    };
    filterDiv.appendChild(btn);
  }

  // Search
  document.getElementById('search').addEventListener('input', e => {
    searchTerm = e.target.value.toLowerCase();
    updateVisibility();
  });

  document.getElementById('showLabels').addEventListener('change', e => {
    linkLabel.style('display', e.target.checked ? 'block' : 'none');
  });

  buildGraph();
}

function buildGraph() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  svg = d3.select('#graph');
  g = svg.append('g');

  // Zoom
  svg.call(d3.zoom()
    .scaleExtent([0.1, 5])
    .on('zoom', e => g.attr('transform', e.transform)));

  // Arrowhead markers
  svg.append('defs').selectAll('marker')
    .data(['arrow'])
    .join('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 20)
    .attr('refY', 0)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-5L10,0L0,5')
    .attr('fill', '#555');

  // Links
  link = g.append('g').selectAll('line')
    .data(data.links)
    .join('line')
    .attr('class', d => 'link' + (d.mandatory ? ' mandatory' : ''))
    .attr('stroke', d => d.mandatory ? '#f55' : '#445')
    .attr('stroke-width', d => d.mandatory ? 2 : 1)
    .attr('marker-end', 'url(#arrow)');

  // Link labels
  linkLabel = g.append('g').selectAll('text')
    .data(data.links)
    .join('text')
    .attr('class', 'link-label')
    .text(d => d.step ? '[' + d.step + '] ' + d.relationship : d.relationship);

  // Nodes
  node = g.append('g').selectAll('g')
    .data(data.nodes)
    .join('g')
    .attr('class', 'node')
    .call(d3.drag()
      .on('start', dragStart)
      .on('drag', dragging)
      .on('end', dragEnd));

  node.append('circle')
    .attr('r', d => TYPE_SIZES[d.type] || 8)
    .attr('fill', d => TYPE_COLORS[d.type] || '#888')
    .attr('stroke', d => d3.color(TYPE_COLORS[d.type] || '#888').brighter(0.8))
    .on('click', (e, d) => showDetail(d));

  node.append('text')
    .attr('dx', d => (TYPE_SIZES[d.type] || 8) + 4)
    .attr('dy', 3)
    .text(d => d.name);

  // Simulation
  simulation = d3.forceSimulation(data.nodes)
    .force('link', d3.forceLink(data.links).id(d => d.id).distance(100))
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(30))
    .on('tick', ticked);
}

function ticked() {
  link
    .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
    .attr('x2', d => d.target.x).attr('y2', d => d.target.y);

  linkLabel
    .attr('x', d => (d.source.x + d.target.x) / 2)
    .attr('y', d => (d.source.y + d.target.y) / 2);

  node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
}

function updateVisibility() {
  const visibleIds = new Set();

  node.classed('dimmed', d => {
    const typeVisible = activeTypes.has(d.type);
    const searchMatch = !searchTerm || 
      d.rawName.toLowerCase().includes(searchTerm) ||
      d.description.toLowerCase().includes(searchTerm) ||
      d.aliases.some(a => a.includes(searchTerm));
    const visible = typeVisible && searchMatch;
    if (visible) visibleIds.add(d.id);
    return !visible;
  });

  link.classed('dimmed', d => {
    const srcId = typeof d.source === 'object' ? d.source.id : d.source;
    const tgtId = typeof d.target === 'object' ? d.target.id : d.target;
    return !visibleIds.has(srcId) || !visibleIds.has(tgtId);
  });

  linkLabel.classed('dimmed', d => {
    const srcId = typeof d.source === 'object' ? d.source.id : d.source;
    const tgtId = typeof d.target === 'object' ? d.target.id : d.target;
    return !visibleIds.has(srcId) || !visibleIds.has(tgtId);
  });
}

function showDetail(d) {
  selectedNode = d;
  const panel = document.getElementById('detail');
  const color = TYPE_COLORS[d.type] || '#888';

  let html = '<h3>' + d.name + '</h3>';
  html += '<span class="type-badge" style="background:' + color + '22;color:' + color + ';border:1px solid ' + color + '44">' + d.type + '</span>';
  // skill_path removed
  html += '<div class="desc">' + d.description + '</div>';

  if (d.attributes.length) {
    html += '<div class="section"><div class="section-title">Attributes</div>';
    for (const a of d.attributes) {
      html += '<div class="attr"><span class="key">' + a.key + ':</span> ' + a.value + '</div>';
    }
    html += '</div>';
  }

  if (d.aliases.length) {
    html += '<div class="section"><div class="section-title">Aliases (' + d.aliases.length + ')</div>';
    html += '<div class="alias-list">' + d.aliases.join(' · ') + '</div></div>';
  }

  // Find connected edges
  const outgoing = data.links.filter(l => (typeof l.source === 'object' ? l.source.id : l.source) === d.id);
  const incoming = data.links.filter(l => (typeof l.target === 'object' ? l.target.id : l.target) === d.id);

  if (outgoing.length) {
    html += '<div class="section"><div class="section-title">Outgoing (' + outgoing.length + ')</div>';
    for (const e of outgoing) {
      const target = data.nodes.find(n => n.id === (typeof e.target === 'object' ? e.target.id : e.target));
      const mand = e.mandatory ? '<span class="mandatory"> ⚠ REQUIRED</span>' : '';
      const step = e.step ? '[' + e.step + '] ' : '';
      html += '<div class="edge-item">' + step + '<span class="edge-rel">' + e.relationship + '</span> → <span class="edge-target">' + (target?.name || '?') + '</span>' + mand;
      if (e.detail) html += '<div class="edge-detail">' + e.detail + '</div>';
      html += '</div>';
    }
    html += '</div>';
  }

  if (incoming.length) {
    html += '<div class="section"><div class="section-title">Incoming (' + incoming.length + ')</div>';
    for (const e of incoming) {
      const source = data.nodes.find(n => n.id === (typeof e.source === 'object' ? e.source.id : e.source));
      html += '<div class="edge-item"><span class="edge-target">' + (source?.name || '?') + '</span> <span class="edge-rel">' + e.relationship + '</span> → this';
      if (e.detail) html += '<div class="edge-detail">' + e.detail + '</div>';
      html += '</div>';
    }
    html += '</div>';
  }

  panel.innerHTML = html;
  panel.style.display = 'block';
}

function dragStart(e, d) { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
function dragging(e, d) { d.fx = e.x; d.fy = e.y; }
function dragEnd(e, d) { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }

init();
</script>
</body>
</html>`;

const server = createServer((req, res) => {
  if (req.url === '/api/graph') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getGraphData()));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🧠 skillgraph.db viewer running at http://localhost:${PORT}`);
});
