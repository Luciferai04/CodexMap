/**
 * orchestrator.js — Root: spawns and coordinates all 4 CodexMap agents
 * Built by @Somu.ai for the OpenAI Codex Hackathon 2025
 *
 * Usage:
 *   node orchestrator.js "<prompt>" [--auto-heal]
 *
 * Start order is critical: Cartographer → Broadcaster → Sentinel → Generator
 * Generator MUST start last so all watchers/listeners are ready.
 */

const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Parse CLI Arguments ────────────────────────────────────────────────────
const prompt = process.argv[2];
const autoHeal = process.argv.includes('--auto-heal');
const enhancedScoring = process.argv.includes('--enhanced-scoring');
const usePageIndex = process.argv.includes('--use-pageindex');
const watchIdx = process.argv.indexOf('--watch');
const externalWatchPath = watchIdx !== -1 ? process.argv[watchIdx + 1] : null;

if (!prompt) {
  console.error('\x1b[31m✖ Error: No prompt provided.\x1b[0m');
  console.error('Usage: node orchestrator.js "<your prompt>" [--auto-heal] [--enhanced-scoring] [--watch <path>]');
  process.exit(1);
}

// ─── Resolve Paths ──────────────────────────────────────────────────────────
const sharedDir = path.join(__dirname, 'shared');
const promptPath = path.join(sharedDir, 'prompt.txt');
const mapStatePath = path.join(sharedDir, 'map-state.json');
const driftLogPath = path.join(sharedDir, 'session-drift-log.json');
const rehealQueuePath = path.join(sharedDir, 'reheal-queue.json');
const healCompletePath = path.join(sharedDir, 'heal-complete.json');
const outputDir = externalWatchPath ? path.resolve(externalWatchPath) : path.join(__dirname, 'output');

// ─── Initialize Shared State ────────────────────────────────────────────────
// Ensure shared directory exists
if (!fs.existsSync(sharedDir)) {
  fs.mkdirSync(sharedDir, { recursive: true });
}

// Ensure output directory exists (Codex writes generated files here)
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Write prompt to shared/prompt.txt
fs.writeFileSync(promptPath, prompt, 'utf8');

// Reset map-state.json to empty graph
fs.writeFileSync(mapStatePath, JSON.stringify({ nodes: [], edges: [] }), 'utf8');

// Reset session-drift-log.json to empty array
fs.writeFileSync(driftLogPath, JSON.stringify([]), 'utf8');

// Reset reheal-queue.json and heal-complete.json
fs.writeFileSync(rehealQueuePath, JSON.stringify([]), 'utf8');
fs.writeFileSync(healCompletePath, JSON.stringify([]), 'utf8');

// ─── Startup Banner ─────────────────────────────────────────────────────────
const banner = `
\x1b[36m╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ██████╗ ██████╗ ██████╗ ███████╗██╗  ██╗   ███╗   ███╗    ║
║  ██╔════╝██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝   ████╗ ████║    ║
║  ██║     ██║   ██║██║  ██║█████╗   ╚███╔╝    ██╔████╔██║    ║
║  ██║     ██║   ██║██║  ██║██╔══╝   ██╔██╗    ██║╚██╔╝██║    ║
║  ╚██████╗╚██████╔╝██████╔╝███████╗██╔╝ ██╗   ██║ ╚═╝ ██║    ║
║   ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝   ╚═╝     ╚═╝    ║
║                                                              ║
║  Live Codebase Intelligence & Context Drift Detection        ║
║  Built by @Somu.ai | OpenAI Codex Hackathon 2025            ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝\x1b[0m
`;

console.log(banner);
console.log(`\x1b[33m📋 Prompt:\x1b[0m ${prompt}`);
console.log(`\x1b[33m🔧 Auto-heal:\x1b[0m ${autoHeal ? 'ENABLED' : 'disabled'}`);
console.log(`\x1b[33m🧠 Advanced Scoring:\x1b[0m ${enhancedScoring ? 'ENABLED' : 'OFF'}`);
console.log(`\x1b[33m📄 PageIndex:\x1b[0m ${usePageIndex ? 'ENABLED' : 'OFF'}`);
console.log('');

// ─── Fork Agents in Strict Order ────────────────────────────────────────────
// Start order: Cartographer → Broadcaster → Sentinel → Generator
// Generator MUST be last (SKILL.md: "Start order is critical")

const agents = [];
const agentNames = ['Cartographer', 'Broadcaster', 'Sentinel', 'Generator'];
const agentPaths = [
  path.join(__dirname, 'agents', 'cartographer.js'),
  path.join(__dirname, 'agents', 'broadcaster.js'),
  path.join(__dirname, 'agents', 'sentinel.js'),
  path.join(__dirname, 'agents', 'generator.js'),
];

const sentinelArgs = [];
if (autoHeal) sentinelArgs.push('--auto-heal');
if (enhancedScoring) sentinelArgs.push('--enhanced-scoring');
if (usePageIndex) sentinelArgs.push('--use-pageindex');

const agentArgs = [
  externalWatchPath ? ['--watch', externalWatchPath] : [], // Cartographer
  [],                                                      // Broadcaster
  sentinelArgs.concat(externalWatchPath ? ['--watch', externalWatchPath] : []), // Sentinel
  externalWatchPath ? ['--watch', externalWatchPath] : [], // Generator
];

agentPaths.forEach((agentPath, index) => {
  const name = agentNames[index];
  try {
    const child = fork(agentPath, agentArgs[index], {
      stdio: ['pipe', 'inherit', 'inherit', 'ipc'],
    });

    child.on('error', (err) => {
      console.error(`\x1b[31m[ORCHESTRATOR] ✖ ${name} failed to start: ${err.message}\x1b[0m`);
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        console.log(`\x1b[33m[ORCHESTRATOR] ${name} killed by signal ${signal}\x1b[0m`);
      } else if (code !== 0) {
        console.error(`\x1b[31m[ORCHESTRATOR] ${name} exited with code ${code}\x1b[0m`);
      } else {
        console.log(`\x1b[32m[ORCHESTRATOR] ${name} exited cleanly\x1b[0m`);
      }
    });

    agents.push(child);
    console.log(`\x1b[32m[ORCHESTRATOR] ✔ ${name} launched (PID: ${child.pid})\x1b[0m`);
  } catch (err) {
    console.error(`\x1b[31m[ORCHESTRATOR] ✖ Failed to fork ${name}: ${err.message}\x1b[0m`);
    // Kill already-started agents on critical failure
    agents.forEach(a => a.kill());
    process.exit(1);
  }
});

console.log('');
console.log('\x1b[36m[ORCHESTRATOR] All agents launched. Press Ctrl+C to stop.\x1b[0m');
console.log(`\x1b[36m[ORCHESTRATOR] Open ui/index.html in your browser to view the live map.\x1b[0m`);
console.log('');

// ─── Graceful Shutdown on SIGINT ────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('');
  console.log('\x1b[33m[ORCHESTRATOR] SIGINT received. Shutting down all agents...\x1b[0m');
  agents.forEach((agent, index) => {
    try {
      agent.kill('SIGTERM');
      console.log(`\x1b[33m[ORCHESTRATOR] Sent SIGTERM to ${agentNames[index]}\x1b[0m`);
    } catch (err) {
      // Agent may already be dead
    }
  });

  // Force kill after 3 seconds if agents don't exit cleanly
  setTimeout(() => {
    agents.forEach((agent, index) => {
      try {
        agent.kill('SIGKILL');
      } catch (err) {
        // Already dead
      }
    });
    console.log('\x1b[31m[ORCHESTRATOR] Force-killed remaining agents.\x1b[0m');
    process.exit(0);
  }, 3000);
});

// ─── Handle unexpected errors ───────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error(`\x1b[31m[ORCHESTRATOR] Uncaught exception: ${err.message}\x1b[0m`);
  agents.forEach(a => { try { a.kill(); } catch(_) {} });
  process.exit(1);
});
