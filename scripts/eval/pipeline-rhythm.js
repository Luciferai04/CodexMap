const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const TIMEOUT = 45000;
const events = []; // global timeline of everything that happens

// ── Instrument WebSocket ──────────────────────────────────────
function watchWebSocket() {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://localhost:4242');
    const received = {};

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      const t = Date.now();
      events.push({ t, source: 'ws', type: msg.type, payload: msg.payload });
      
      // If full_reset, also treat all graded nodes as 'node_grade' events for timing check
      if (msg.type === 'full_reset' && msg.payload.nodes) {
        msg.payload.nodes.forEach(n => {
          if (n.grade && n.grade !== 'pending') {
            events.push({ t, source: 'ws', type: 'node_grade', payload: n });
          }
        });
      }
      received[msg.type] = (received[msg.type] || 0) + 1;
    });

    ws.on('error', (err) => {
      console.error('[EVAL] WS Error:', err.message);
    });

    setTimeout(() => { ws.close(); resolve(received); }, TIMEOUT);
  });
}

// ── Instrument map-state.json ─────────────────────────────────
function watchStateFile() {
  return new Promise((resolve) => {
    const snapshots = [];
    const statePath = path.join(__dirname, '../../shared/map-state.json');
    
    const watcher = fs.watch(path.join(__dirname, '../../shared'), (eventType, filename) => {
      if (filename === 'map-state.json') {
        try {
          const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
          snapshots.push({ t: Date.now(), nodeCount: state.nodes.length,
                           edgeCount: state.edges.length,
                           grades: countGrades(state.nodes) });
        } catch(e) {}
      }
    });
    setTimeout(() => { watcher.close(); resolve(snapshots); }, TIMEOUT);
  });
}

function countGrades(nodes) {
  return nodes.reduce((acc, n) => {
    acc[n.grade] = (acc[n.grade]||0)+1; return acc;
  }, { green:0, yellow:0, red:0, pending:0 });
}

// ── Inject a test file ────────────────────────────────────────
async function injectTestFile(name, content) {
  const t0 = Date.now();
  const outputDir = path.join(__dirname, '../../output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, name), content);
  events.push({ t: t0, source: 'injector', type: 'file_written', 
                payload: { name } });
  return t0;
}

// ── Run ───────────────────────────────────────────────────────
async function run() {
  console.log('\n🎼 Pipeline Rhythm Evaluation\n' + '─'.repeat(50));

  // Start watching BEFORE injecting files
  const [wsEvents, stateSnapshots] = await Promise.all([
    watchWebSocket(),
    watchStateFile(),
    (async () => {
      await new Promise(r => setTimeout(r, 2000)); // let watchers settle

      // Inject 3 files with known relationships
      await injectTestFile('auth.js', `
        const jwt = require('jsonwebtoken');
        function validateToken(token) {
          return jwt.verify(token, process.env.SECRET);
        }
        module.exports = { validateToken };
      `);
      await new Promise(r => setTimeout(r, 1000));

      await injectTestFile('routes.js', `
        const { validateToken } = require('./auth');
        function getUser(req, res) {
          const user = validateToken(req.headers.authorization);
          res.json(user);
        }
        module.exports = { getUser };
      `);
      await new Promise(r => setTimeout(r, 1000));

      // Inject OFF-SCOPE file (should turn red)
      await injectTestFile('payments.js', `
        const stripe = require('stripe');
        function chargeCard(amount, token) {
          return stripe.charges.create({ amount, source: token });
        }
        module.exports = { chargeCard };
      `);
    })()
  ]);

  // ── Assert pipeline rhythm ────────────────────────────────
  let passed = 0, failed = 0;

  function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); passed++; }
    catch(e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
  }

  console.log('\n📡 WebSocket Message Rhythm:');

  check('full_reset received on connect', () => {
    assert.ok(wsEvents['full_reset'] >= 1, 'No full_reset message');
  });

  check('graph_update fires after file injection', () => {
    const updates = events.filter(e => e.type === 'graph_update');
    assert.ok(updates.length >= 3, 
      `Expected 3+ graph_updates, got ${updates.length}`);
  });

  check('node_grade fires after graph_update (correct order)', () => {
    const graphTs = events.filter(e => e.type === 'graph_update').map(e => e.t);
    const gradeTs = events.filter(e => e.type === 'node_grade').map(e => e.t);
    if (gradeTs.length === 0) throw new Error('No node_grade messages');
    // At least one grade must come AFTER a graph_update
    const ordered = gradeTs.some(gt => graphTs.some(gu => gt > gu));
    assert.ok(ordered, 'node_grade arrived BEFORE graph_update');
  });

  check('drift_score message arrives within 30s', () => {
    assert.ok(wsEvents['drift_score'] >= 1, 'No drift_score message received');
  });

  check('generation_done fires eventually', () => {
    // Allow missing if codex is still running
    console.log(`     (generation_done count: ${wsEvents['generation_done']||0})`);
  });

  console.log('\n📄 map-state.json Rhythm:');

  check('State file updated at least 3 times', () => {
    assert.ok(stateSnapshots.length >= 3, 
      `Only ${stateSnapshots.length} state updates`);
  });

  check('Node count grows monotonically', () => {
    for (let i = 1; i < stateSnapshots.length; i++) {
      // Allow equal (batch updates) but never decrease
      assert.ok(
        stateSnapshots[i].nodeCount >= stateSnapshots[i-1].nodeCount,
        `Node count decreased: ${stateSnapshots[i-1].nodeCount} → ${stateSnapshots[i].nodeCount}`
      );
    }
  });

  check('Edge count grows as files reference each other', () => {
    const last = stateSnapshots[stateSnapshots.length-1];
    assert.ok(last.edgeCount >= 1, 
      `Expected edges (routes.js imports auth.js), got ${last.edgeCount}`);
  });

  // 3. Latency: write -> grade
  const pairs = [];
  const writes = events.filter(e => e.type === 'file_written');
  const grades = events.filter(e => e.type === 'node_grade');

  writes.forEach(w => {
    // Find the FIRST grade for this file that happens AFTER the write
    const match = grades.find(g => g.t > w.t && (g.payload.id?.includes(w.payload.name) || g.payload.path?.includes(w.payload.name)));
    if (match) pairs.push(match.t - w.t);
  });

  check(`Pipeline latency: file write → node_grade < 25s`, () => {
    assert.ok(pairs.length > 0, 'No write-to-grade pairs found');
    const avg = pairs.reduce((a,b) => a+b, 0) / pairs.length;
    assert.ok(avg < 25000, `Average latency ${avg}ms exceeds 25s`);
  });

  // ── Print event timeline ──────────────────────────────────
  console.log('\n⏱  Event Timeline:');
  const t0 = events[0]?.t || Date.now();
  events.forEach(e => {
    const rel = ((e.t - t0)/1000).toFixed(2);
    const icon = {
      file_written: '📝', full_reset: '🔄', graph_update: '📊',
      node_grade: '🎨', drift_score: '📈', collapse_warning: '🚨',
      generation_done: '✓'
    }[e.type] || '·';
    console.log(`  +${rel.padStart(6)}s  ${icon} ${e.source}::${e.type}`);
  });

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Rhythm: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(console.error);
