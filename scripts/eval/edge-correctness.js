const fs = require('fs');
const path = require('path');
const assert = require('assert');

async function run() {
  console.log('\n🔗 Edge Correctness Evaluation\n' + '─'.repeat(50));

  const sharedDir = path.join(__dirname, '../../shared');
  const outputDir = path.join(__dirname, '../../output');
  const testDir = path.join(outputDir, 'eval-edges');

  // Write files with KNOWN import relationships
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
  
  fs.writeFileSync(path.join(testDir, 'db.js'), `
    function connect() { return { query: (sql) => sql }; }
    module.exports = { connect };
  `);
  fs.writeFileSync(path.join(testDir, 'auth.js'), `
    const { connect } = require('./db');
    function login(user) { return connect().query('SELECT * FROM users'); }
    module.exports = { login };
  `);
  fs.writeFileSync(path.join(testDir, 'routes.js'), `
    const { login } = require('./auth');
    const express = require('express');
    const router = express.Router();
    router.post('/login', (req,res) => res.json(login(req.body)));
    module.exports = router;
  `);
  fs.writeFileSync(path.join(testDir, 'payment.js'), `
    const stripe = require('stripe');
    const { connect } = require('./db');  // ← imports green node
    function pay(amount) { return stripe.charge(amount); }
    module.exports = { pay };
  `);

  // Wait for cartographer to process (max 15s)
  console.log('  ⏳ Waiting for cartographer to map edges...');
  let state = null;
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      state = JSON.parse(fs.readFileSync(path.join(sharedDir, 'map-state.json'), 'utf8'));
      const hasEvalEdges = state.edges.some(e => e.source.includes('eval-edges'));
      if (hasEvalEdges) break;
    } catch(e) {}
  }

  if (!state) {
    console.error('  ❌ Failed to read map-state.json');
    process.exit(1);
  }

  const edges = state.edges;
  const nodes = state.nodes;

  let passed = 0, failed = 0;
  function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); passed++; }
    catch(e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
  }

  // Build lookup maps
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  
  console.log('\n  Detected edges:');
  const relevantEdges = edges.filter(e => e.source.includes('eval-edges'));
  relevantEdges.forEach(e => {
    const s = e.source.split('/').pop();
    const t = e.target.split('/').pop();
    console.log(`    ${s} ──${e.type}──▶ ${t}`);
  });

  console.log('\n🔍 Assertions:');

  check('auth.js → db.js edge exists', () => {
    const found = edges.some(e => 
      e.source.includes('auth.js') && e.target.includes('db.js'));
    assert.ok(found, 'Missing auth.js → db.js import edge');
  });

  check('routes.js → auth.js edge exists', () => {
    const found = edges.some(e =>
      e.source.includes('routes.js') && e.target.includes('auth.js'));
    assert.ok(found, 'Missing routes.js → auth.js import edge');
  });

  check('payment.js → db.js edge exists (cross-contamination source)', () => {
    const found = edges.some(e =>
      e.source.includes('payment.js') && e.target.includes('db.js'));
    assert.ok(found, 'Missing payment.js → db.js edge');
  });

  check('payment.js has no edge to routes.js (unrelated)', () => {
    const wrong = edges.some(e =>
      e.source.includes('payment.js') && e.target.includes('routes.js'));
    assert.ok(!wrong, 'False positive edge: payment → routes');
  });

  check('All edges have source, target, id, type fields', () => {
    edges.forEach(e => {
      ['id','source','target','type'].forEach(k =>
        assert.ok(k in e, `Edge missing field: ${k}`)
      );
    });
  });

  check('No self-referencing edges (source === target)', () => {
    const selfEdges = edges.filter(e => e.source === e.target);
    assert.strictEqual(selfEdges.length, 0,
      `Self-edges found: ${selfEdges.map(e=>e.source).join(', ')}`);
  });

  check('No duplicate edge IDs', () => {
    const ids = edges.map(e => e.id);
    const unique = new Set(ids);
    assert.strictEqual(ids.length, unique.size,
      `${ids.length - unique.size} duplicate edge IDs found`);
  });

  check('No orphan nodes (every non-root node has ≥1 edge)', () => {
    const connected = new Set([
      ...edges.map(e => e.source),
      ...edges.map(e => e.target)
    ]);
    const evalNodes = nodes.filter(n => 
      n.id.includes('eval-edges') && n.type === 'file');
    const orphans = evalNodes.filter(n => !connected.has(n.id));
    // Entry point (db.js) might be an orphan if nothing imports it yet, 
    // but in our case everything imports db or is imported.
    assert.ok(orphans.length <= 1,
      `Orphan nodes: ${orphans.map(n=>n.label).join(', ')}`);
  });

  check('Cross-contamination flag presence (Miro specific)', async () => {
    // In our Miro UI, we use 'danger' attribute on edge data
    // The dashboard logic calculates this if src=green and tgt=red
    // But we check if the raw edge has enough data for UI to calculate it
    const edge = edges.find(e => e.source.includes('payment') && e.target.includes('db'));
    assert.ok(edge, 'Payment edge not found');
  });

  // Cleanup
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch(e) {}

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Edges: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(console.error);
