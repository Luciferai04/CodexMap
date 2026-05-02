const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EVALS = [
  { name: 'Pipeline Rhythm',   script: 'pipeline-rhythm.js',    critical: true },
  { name: 'Grade Transitions', script: 'grade-transitions.js',  critical: true },
  { name: 'Edge Correctness',  script: 'edge-correctness.js',   critical: true },
  { name: 'PageIndex Diff',    script: 'pageindex-diff.js',     critical: false },
  { name: 'Frontend Files',    script: 'frontend-tests.js',     critical: true },
];

const results = [];
const startTime = Date.now();

console.log('\n╔══════════════════════════════════════════════╗');
console.log('║      CodexMap — Full Eval Suite              ║');
console.log('╚══════════════════════════════════════════════╝\n');

// Check orchestrator is running first
try {
  execSync('curl -s http://localhost:3000/health', { timeout: 3000 });
  console.log('⚡ Pre-check: Orchestrator is running and healthy');
} catch(e) {
  console.log('   ⚠  Orchestrator not responding on :3000');
  console.log('   Run: node orchestrator.js "your prompt" --enhanced-scoring\n');
}

console.log('\n[CLEANUP] Clearing state for clean evaluation...');
try {
  const sharedDir = path.join(__dirname, '../../shared');
  const outputDir = path.join(__dirname, '../../output');
  
  // Clear shared JSONs
  if (fs.existsSync(sharedDir)) {
    fs.readdirSync(sharedDir).forEach(f => {
      if (f.endsWith('.json') && f !== 'prompt.txt' && f !== 'pageindex-tree.json') {
        try { fs.unlinkSync(path.join(sharedDir, f)); } catch(e) {}
      }
    });
  }

  // Clear output files
  if (fs.existsSync(outputDir)) {
    fs.readdirSync(outputDir).forEach(f => {
      try { fs.unlinkSync(path.join(outputDir, f)); } catch(e) {}
    });
  }
} catch(e) {
  console.log('   Cleanup warning:', e.message);
}

for (const eval_ of EVALS) {
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`▶  Running: ${eval_.name}`);
  console.log(`${'═'.repeat(50)}`);
  
  const t0 = Date.now();
  const scriptPath = path.resolve(__dirname, eval_.script);
  const result = spawnSync('node', 
    [scriptPath], 
    { stdio: 'inherit', timeout: 90000, cwd: path.resolve(__dirname, '../..') }
  );
  const duration = ((Date.now() - t0)/1000).toFixed(1);
  
  results.push({
    name: eval_.name,
    passed: result.status === 0,
    duration,
    critical: eval_.critical,
    exitCode: result.status,
  });
}

// ── Report Card ───────────────────────────────────────────────
const totalTime = ((Date.now() - startTime)/1000).toFixed(1);
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
const criticalFailed = results.filter(r => !r.passed && r.critical);

console.log('\n\n╔══════════════════════════════════════════════╗');
console.log('║              EVAL REPORT CARD                ║');
console.log('╠══════════════════════════════════════════════╣');
results.forEach(r => {
  const icon = r.passed ? '✅' : (r.critical ? '❌' : '⚠ ');
  const tag = r.critical ? '' : ' (non-critical)';
  console.log(`║  ${icon}  ${r.name.padEnd(28)} ${r.duration.padStart(5)}s${tag.padEnd(14)}║`);
});
console.log('╠══════════════════════════════════════════════╣');
console.log(`║  Total: ${passed}/${results.length} passed    Duration: ${totalTime.padStart(5)}s          ║`);
console.log('╚══════════════════════════════════════════════╝\n');

if (criticalFailed.length > 0) {
  console.log('🚨 CRITICAL FAILURES:');
  criticalFailed.forEach(r => console.log(`   - ${r.name}`));
  console.log('\nFix critical failures before submitting to hackathon.\n');
  process.exit(1);
} else if (failed > 0) {
  console.log('⚠  Non-critical failures present but pipeline is functional.\n');
  process.exit(0);
} else {
  console.log('🎉 All evals passed. CodexMap is ready.\n');
  process.exit(0);
}
