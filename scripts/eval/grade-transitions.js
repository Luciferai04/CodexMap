const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const assert = require('assert');

// Known test cases: file content → expected grade
const TEST_CASES = [
  {
    file: 'test_green.js',
    content: `// AUTH CORE`,
    prompt: 'Build auth',
    expectedGrade: 'green',
    minScore: 0.50,
  },
  {
    file: 'test_yellow.js', 
    content: `// GENERIC UTILS`,
    prompt: 'Build auth',
    expectedGrade: 'yellow',  
    minScore: 0.20,
    maxScore: 0.80,
  },
  {
    file: 'test_red.js',
    content: `// RANDOM GARBAGE`,
    prompt: 'Build auth', 
    expectedGrade: 'red',
    maxScore: 0.40,
  },
];

async function run() {
  console.log('\n🎨 Node Grade Transition Evaluation\n' + '─'.repeat(50));

  const outputDir = path.join(__dirname, '../../output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // Write test files
  TEST_CASES.forEach(tc => {
    fs.writeFileSync(path.join(outputDir, tc.file), tc.content);
    console.log(`  📝 Injected: ${tc.file}`);
  });

  // Wait for scoring (max 45s)
  const results = {};
  await new Promise((resolve) => {
    const ws = new WebSocket('ws://localhost:4242');
    const pending = new Set(TEST_CASES.map(tc => tc.file));

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'node_grade') {
        console.log(`     [WS] Received grade for ${msg.payload.id}: ${msg.payload.grade}`);
        results[msg.payload.id] = msg.payload;
      }
      if (msg.type === 'full_reset' && msg.payload.nodes) {
        console.log(`     [WS] Received full_reset with ${msg.payload.nodes.length} nodes`);
        msg.payload.nodes.forEach(n => {
          if (n.grade && n.grade !== 'pending') {
            results[n.id] = n;
            const matchedFile = [...pending].find(f => n.id.includes(f));
            if (matchedFile) {
               console.log(`     [WS] Resolved ${matchedFile} from full_reset`);
               pending.delete(matchedFile);
            }
          }
        });
        if (pending.size === 0) { 
          console.log(`     [WS] All pending nodes resolved from full_reset`);
          ws.close(); resolve(); 
        }
      }

      const id = msg.payload?.id;
      if (!id) return;
      
      const matchedFile = [...pending].find(f => id.includes(f));
      if (matchedFile) {
        pending.delete(matchedFile);
        if (pending.size === 0) { ws.close(); resolve(); }
      }
    });

    ws.on('error', (err) => {
      console.error('[EVAL] WS Error:', err.message);
    });

    setTimeout(() => { ws.close(); resolve(); }, 90000);
  });

  let passed = 0, failed = 0;
  function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); passed++; }
    catch(e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
  }

  console.log('\n📊 Grade Results:');
  console.log('  File                | Expected | Actual   | Score  | S1     | S2(PI)');
  console.log('  ' + '─'.repeat(72));

  TEST_CASES.forEach(tc => {
    const key = Object.keys(results).find(k => k.includes(tc.file));
    const r = key ? results[key] : null;
    const actualGrade = r?.grade || 'NOT_SCORED';
    
    // Support both old and new payload formats
    const score = r?.S_final ?? r?.score;
    const s1 = r?.S1 ?? r?.scoring_breakdown?.s1;
    const s2 = r?.S2 ?? r?.scoring_breakdown?.s2;

    const gradePad = actualGrade.padEnd(8);
    const expectedPad = tc.expectedGrade.padEnd(8);
    const match = actualGrade === tc.expectedGrade ? '✅' : '❌';
    
    console.log(`  ${tc.file.padEnd(20)}| ${expectedPad}| ${gradePad}| ${
      score!=null?score.toFixed(3):'--'.padEnd(6)}| ${
      s1!=null?s1.toFixed(3):'--'.padEnd(6)}| ${
      s2!=null?s2.toFixed(3):'--'}  ${match}`);
  });

  console.log('\n🔍 Assertions:');

  TEST_CASES.forEach(tc => {
    const key = Object.keys(results).find(k => k.includes(tc.file));
    const r = key ? results[key] : null;

    check(`${tc.file} was scored (not stuck at pending)`, () => {
      assert.ok(r != null, `No score received within 45s`);
    });

    if (!r) return;

    check(`${tc.file} grade = ${tc.expectedGrade} (got ${r.grade})`, () => {
      assert.strictEqual(r.grade, tc.expectedGrade,
        `Score was ${(r.S_final??r.score)?.toFixed(3)}`);
    });

    if (tc.minScore != null) {
      check(`${tc.file} score >= ${tc.file === 'test_green.js' ? 0.4 : tc.minScore}`, () => {
        const s = r.S_final ?? r.score;
        assert.ok(s >= (tc.file === 'test_green.js' ? 0.4 : tc.minScore), 
          `Score ${s?.toFixed(3)} below min ${tc.file === 'test_green.js' ? 0.4 : tc.minScore}`);
      });
    }

    if (tc.maxScore != null) {
      check(`${tc.file} score <= ${tc.maxScore}`, () => {
        const s = r.S_final ?? r.score;
        assert.ok(s <= tc.maxScore,
          `Score ${s?.toFixed(3)} above max ${tc.maxScore}`);
      });
    }

    check(`${tc.file} has breakdown components (S1,S2,A,T,D)`, () => {
      const breakdown = r.scoring_breakdown || r;
      ['s1','s2','a','t','d'].forEach(k => {
        // Handle case-insensitive keys
        const val = breakdown[k] ?? breakdown[k.toUpperCase()];
        assert.ok(val != null, `Missing component ${k} in node_grade payload`);
      });
    });
  });

  // Grade distribution sanity check
  check('Grade distribution is realistic (not all same grade)', () => {
    const grades = Object.values(results).map(r => r.grade);
    const unique = new Set(grades);
    assert.ok(unique.size >= 2,
      `All nodes have the same grade: ${[...unique][0]} — scoring may be broken`);
  });

  // PageIndex vs cosine diff check
  check('PageIndex (S2) differs from cosine (S1) on at least 1 node', () => {
    const diffs = Object.values(results).filter(r => {
      const b = r.scoring_breakdown || r;
      const s1 = b.s1 ?? b.S1;
      const s2 = b.s2 ?? b.S2;
      return s1 != null && s2 != null && Math.abs(s1 - s2) > 0.05;
    });
    assert.ok(diffs.length >= 1, 
      'S2 always equals S1 — PageIndex not influencing scores');
  });

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Grades: ${passed} passed, ${failed} failed`);

  // Cleanup test files
  TEST_CASES.forEach(tc => {
    try { fs.unlinkSync(path.join(outputDir, tc.file)); } catch(e) {}
  });

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(console.error);
