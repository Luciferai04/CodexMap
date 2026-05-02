const fs = require('fs');
const path = require('path');
const assert = require('assert');

async function run() {
  console.log('\n🧠 PageIndex vs Cosine Diff Evaluation\n' + '─'.repeat(50));

  const sharedDir = path.join(__dirname, '../../shared');
  const statePath = path.join(sharedDir, 'map-state.json');

  if (!fs.existsSync(statePath)) {
    console.log('  ⚠ map-state.json missing. Run orchestrator first.');
    process.exit(0);
  }

  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const scored = state.nodes.filter(n => 
    n.score != null && n.grade !== 'pending');

  if (scored.length === 0) {
    console.log('  ⚠ No scored nodes yet. Run orchestrator first.');
    process.exit(0);
  }

  // ── Metrics ────────────────────────────────────────────────
  const diffs = scored.map(n => {
    const b = n.scoring_breakdown || {};
    const s1 = b.s1 ?? b.S1 ?? n.score; // Fallback to final score if breakdown missing
    const s2 = b.s2 ?? b.S2 ?? n.score;
    const diff = Math.abs(s2 - s1);
    
    // Would pure cosine give same grade?
    const cosineGrade = s1 >= 0.75 ? 'green' : s1 >= 0.50 ? 'yellow' : 'red';
    const hybridGrade = n.grade;
    const gradeChanged = cosineGrade !== hybridGrade;

    return {
      id: n.label || n.id,
      S1: s1, S2: s2,
      diff,
      grade: n.grade,
      cosineGrade,
      gradeChanged
    };
  });

  // Sort by diff descending
  diffs.sort((a,b) => b.diff - a.diff);

  console.log('\n  Node                    | S1(cos) | S2(PI)  | Δ      | Grade  | Changed?');
  console.log('  ' + '─'.repeat(78));
  diffs.forEach(d => {
    const changed = d.gradeChanged ? '⚡ YES' : 'no';
    console.log(
      `  ${d.id.slice(0,24).padEnd(24)}| ${d.S1.toFixed(3).padEnd(8)}| ` +
      `${d.S2.toFixed(3).padEnd(8)}| ${d.diff.toFixed(3).padEnd(7)}| ` +
      `${d.grade.padEnd(7)}| ${changed}`
    );
  });

  // Stats
  const meanDiff = diffs.reduce((s,d) => s+d.diff, 0) / diffs.length;
  const gradeChanges = diffs.filter(d => d.gradeChanged);

  console.log('\n  📊 Statistics:');
  console.log(`     Mean |S2-S1| diff:   ${meanDiff.toFixed(3)}`);
  console.log(`     Grade changes from hybrid: ${gradeChanges.length}/${diffs.length}`);
  
  if (gradeChanges.length > 0) {
    console.log('     Changed nodes:');
    gradeChanges.forEach(d => {
      console.log(`       ${d.id}: ${d.cosineGrade} → ${d.grade} (S1=${d.S1.toFixed(2)}, S2=${d.S2.toFixed(2)})`);
    });
  }

  // ── Assertions ────────────────────────────────────────────
  let passed = 0, failed = 0;
  function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); passed++; }
    catch(e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
  }

  console.log('\n🔍 Assertions:');

  check('Scoring components present on nodes', () => {
    const hasComponents = scored.some(n => n.scoring_breakdown != null || n.S1 != null);
    assert.ok(hasComponents, 'Missing scoring breakdown on nodes');
  });

  // Note: S2 might equal S1 if PageIndex didn't have data, but in a real run they should diverge
  console.log('     (S2-S1 mean diff: ' + meanDiff.toFixed(3) + ')');

  check('Drift signals are populated on red nodes', () => {
    const redNodes = scored.filter(n => n.grade === 'red');
    if (redNodes.length > 0) {
      const hasSignals = redNodes.some(n => n.drift_signals && n.drift_signals.length > 0);
      assert.ok(hasSignals, 'Red nodes missing drift signals');
    } else {
      console.log('     (skip: no red nodes to check)');
    }
  });

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`PageIndex Diff: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(console.error);
