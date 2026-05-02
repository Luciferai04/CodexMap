const assert = require('assert');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ─── Test Runner ───────────────────────────────────────────────
let passed = 0, failed = 0;
async function test(name, fn) {
  try { 
    await fn(); 
    console.log(`  ✅ ${name}`); 
    passed++; 
  } catch(e) { 
    console.error(`  ❌ ${name}: ${e.message}`); 
    failed++; 
  }
}
// ───────────────────────────────────────────────────────────────

async function runTests() {
  const sharedDir = path.join(__dirname, '../../shared');
  const uiDir = path.join(__dirname, '../../ui');

  // GROUP 1: WebSocket Connection
  console.log('\n📡 WebSocket Connection Tests');

  // Check if WS is reachable first
  let wsAvailable = false;
  await test('WS connects to localhost:4242', async () => {
    const ws = new WebSocket('ws://localhost:4242');
    await new Promise((res, rej) => {
      ws.on('open', () => { wsAvailable = true; ws.close(); res(); });
      ws.on('error', (err) => rej(new Error('ECONNREFUSED — orchestrator not running')));
      setTimeout(() => rej(new Error('timeout')), 3000);
    });
  });

  if (wsAvailable) {
    await test('WS sends full_reset on connect', async () => {
      const ws = new WebSocket('ws://localhost:4242');
      ws.on('error', () => {});
      const msg = await new Promise((res, rej) => {
        ws.on('message', d => { ws.close(); res(JSON.parse(d)); });
        setTimeout(() => rej(new Error('no message in 5s')), 5000);
      });
      assert.strictEqual(msg.type, 'full_reset', 'Expected full_reset on connect');
      assert.ok(Array.isArray(msg.payload?.nodes), 'full_reset.payload.nodes must be array');
      assert.ok(Array.isArray(msg.payload?.edges), 'full_reset.payload.edges must be array');
    });

    await test('full_reset payload matches node schema from SKILL.md', async () => {
      const ws = new WebSocket('ws://localhost:4242');
      ws.on('error', () => {});
      const msg = await new Promise(res => ws.on('message', d => { ws.close(); res(JSON.parse(d)); }));
      if (msg.payload.nodes.length === 0) return;
      const node = msg.payload.nodes[0];
      const required = ['id','label','type','path','grade','score','drift_signals'];
      required.forEach(k => assert.ok(k in node, `Node missing field: ${k}`));
      assert.ok(Array.isArray(node.drift_signals), 'drift_signals must be array');
    });

    await test('full_reset edges match Miro schema', async () => {
      const ws = new WebSocket('ws://localhost:4242');
      ws.on('error', () => {});
      const msg = await new Promise(res => ws.on('message', d => { ws.close(); res(JSON.parse(d)); }));
      if (msg.payload.edges.length === 0) return;
      const edge = msg.payload.edges[0];
      assert.ok('source' in edge);
      assert.ok('target' in edge);
    });
  } else {
    console.log('  ⏭  Skipping WS message tests (orchestrator not running)');
  }

  // GROUP 2: map-state.json Schema
  console.log('\n📄 map-state.json Schema Tests');

  const mapStatePath = path.join(sharedDir, 'map-state.json');

  await test('map-state.json is valid JSON', () => {
    const raw = fs.readFileSync(mapStatePath, 'utf8');
    JSON.parse(raw); 
  });

  await test('map-state.json has nodes and edges arrays', () => {
    const state = JSON.parse(fs.readFileSync(mapStatePath, 'utf8'));
    assert.ok(Array.isArray(state.nodes));
    assert.ok(Array.isArray(state.edges));
  });

  await test('All nodes have valid grade values', () => {
    const state = JSON.parse(fs.readFileSync(mapStatePath, 'utf8'));
    const valid = ['pending','green','yellow','red'];
    state.nodes.forEach(n => {
      assert.ok(valid.includes(n.grade), `Invalid grade "${n.grade}" on node ${n.id}`);
    });
  });

  // GROUP 4: Grade Mapping (Miro Pastel Tokens)
  console.log('\n🎨 Miro Design Token Tests');

  const variablesPath = path.join(uiDir, 'styles/variables.css');

  await test('variables.css exists with Miro tokens', () => {
    const css = fs.readFileSync(variablesPath, 'utf8');
    const required = ['--color-near-black', '--color-blue-450', '--color-success',
                      '--color-border', '--color-ring', '--color-teal-light',
                      '--color-coral-light', '--color-orange-light',
                      '--grade-green-bg', '--grade-yellow-bg', '--grade-red-bg'];
    required.forEach(token => {
      assert.ok(css.includes(token), `Missing token: ${token}`);
    });
  });

  await test('grade-green uses teal pair (#c3faf5 / #187574)', () => {
    const css = fs.readFileSync(variablesPath, 'utf8');
    assert.ok(css.includes('#c3faf5'), 'Missing teal-light #c3faf5 for green');
    assert.ok(css.includes('#187574'), 'Missing teal-dark #187574 for green');
  });

  // GROUP 5: PageIndex (Vectorless RAG)
  console.log('\n🧠 PageIndex Integration Tests');

  const treePath = path.join(sharedDir, 'pageindex-tree.json');

  await test('pageindex-tree.json exists', () => {
    assert.ok(fs.existsSync(treePath), 'pageindex-tree.json missing');
  });

  await test('pageindex-tree.json contains nodes', () => {
    const tree = JSON.parse(fs.readFileSync(treePath, 'utf8'));
    assert.ok(Array.isArray(tree.nodes), 'tree.nodes must be array');
  });

  // GROUP 6: Frontend File Integrity
  console.log('\n📁 Frontend File Tests');

  const requiredFiles = [
    'index.html', 'graph.js', 'panel.js', 'drift-timeline.js',
    'styles/variables.css', 'styles/base.css', 'styles/toolbar.css',
    'styles/sidebar.css', 'styles/panel.css', 'styles/canvas.css',
    'styles/tooltips.css'
  ];

  for (const f of requiredFiles) {
    await test(`File exists: ${f}`, () => {
      const fullPath = path.join(uiDir, f);
      assert.ok(fs.existsSync(fullPath), `Missing: ${fullPath}`);
      assert.ok(fs.statSync(fullPath).size > 0, `Empty file: ${fullPath}`);
    });
  }

  // ─── Summary ───────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed+failed} tests`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
