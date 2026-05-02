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
const http = require('http');

// Config validation
const { config, validate } = require('./config');
const errors = validate();
if (errors.length > 0) {
  console.error('\n❌ CodexMap startup failed:\n');
  errors.forEach(e => console.error(`   • ${e}`));
  console.error('\nFix .env and retry.\n');
  process.exit(1);
}

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('[Orchestrator] Uncaught exception:', err.message);
  fs.appendFileSync('./shared/error.log', `${new Date().toISOString()} UNCAUGHT: ${err.stack}\n`);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Orchestrator] Unhandled rejection:', reason);
  fs.appendFileSync('./shared/error.log', `${new Date().toISOString()} REJECTION: ${reason}\n`);
});


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

// Hackathon features initialization
const driftHistoryPath = path.join(sharedDir, 'drift-history.json');
const archHealthPath = path.join(sharedDir, 'arch-health.json');
const healQueuePath = path.join(sharedDir, 'heal-queue.json');
const settingsPath = path.join(sharedDir, 'settings.json');
const trackingPath = path.join(sharedDir, 'tracking.json');

fs.writeFileSync(driftHistoryPath, JSON.stringify({ snapshots: [] }, null, 2), 'utf8');
fs.writeFileSync(archHealthPath, JSON.stringify({}, null, 2), 'utf8');
fs.writeFileSync(healQueuePath, JSON.stringify({ queue: [] }, null, 2), 'utf8');
fs.writeFileSync(settingsPath, JSON.stringify({ autoHeal: false }, null, 2), 'utf8');
fs.writeFileSync(trackingPath, JSON.stringify({ trackedPath: outputDir, updatedAt: new Date().toISOString() }, null, 2), 'utf8');

// ─── Startup Banner ─────────────────────────────────────────────────────────
const { version } = require('./version');
console.log(`
╔═══════════════════════════════════════╗
║  CodexMap v${version}                   ║
║  Real-time codebase intelligence      ║
║  by @Somu.ai                          ║
╚═══════════════════════════════════════╝
`);
console.log(`\x1b[33m📋 Prompt:\x1b[0m ${prompt}`);
console.log(`\x1b[33m🔧 Auto-heal:\x1b[0m ${autoHeal ? 'ENABLED' : 'disabled'}`);
console.log(`\x1b[33m🧠 Advanced Scoring:\x1b[0m ${enhancedScoring ? 'ENABLED' : 'OFF'}`);
console.log(`\x1b[33m📄 PageIndex:\x1b[0m ${usePageIndex ? 'ENABLED' : 'OFF'}`);
console.log('');

// --- Initial PageIndex Build ---
if (usePageIndex) {
  console.log('\x1b[36m[ORCHESTRATOR] 🧠 Building PageIndex tree...\x1b[0m');
  try {
    const { execSync } = require('child_process');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const pyScript = path.join(__dirname, 'scripts/pageindex_build.py');
    execSync(`${pythonCmd} "${pyScript}" "${outputDir}" "${prompt}"`, { stdio: 'inherit' });
    console.log('\x1b[32m[ORCHESTRATOR] ✔ PageIndex tree built successfully\x1b[0m\n');
  } catch (err) {
    console.error(`\x1b[31m[ORCHESTRATOR] ✖ PageIndex build failed: ${err.message}\x1b[0m\n`);
  }
}

// ─── Fork Agents in Strict Order ────────────────────────────────────────────
// Start order: Cartographer → Broadcaster → Sentinel → Historian → Architect → Healer → Generator
// Generator MUST be last (SKILL.md: "Start order is critical")

const agents = [];
const agentNames = ['Cartographer', 'Broadcaster', 'Sentinel', 'Historian', 'Architect', 'Healer', 'Generator'];
const agentPaths = [
  path.join(__dirname, 'agents', 'cartographer.js'),
  path.join(__dirname, 'agents', 'broadcaster.js'),
  path.join(__dirname, 'agents', 'sentinel.js'),
  path.join(__dirname, 'agents', 'historian.js'),
  path.join(__dirname, 'agents', 'architect.js'),
  path.join(__dirname, 'agents', 'healer.js'),
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
  [], // Historian
  [], // Architect
  [], // Healer
  externalWatchPath ? ['--watch', externalWatchPath] : [], // Generator
];

// Agent crash recovery
function forkWithRecovery(agentPath, name, args = []) {
  const agent = fork(agentPath, args, { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  
  agent.stdout.on('data', (data) => process.stdout.write(data));
  agent.stderr.on('data', (data) => process.stderr.write(data));
  
  agent.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`[Orchestrator] ${name} crashed (code ${code}), restarting in 2s...`);
      setTimeout(() => {
        const newAgent = forkWithRecovery(agentPath, name, args);
        agents[agentNames.indexOf(name)] = newAgent;
      }, 2000);
    }
  });
  return agent;
}

agentPaths.forEach((agentPath, index) => {
  const name = agentNames[index];
  const child = forkWithRecovery(agentPath, name, agentArgs[index]);
  agents.push(child);
});

    const logFile = path.join(sharedDir, 'agent-logs.json');
    if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, JSON.stringify([]));

    const appendLog = (data, isError) => {
      const msg = data.toString().trim();
      if (!msg) return;
      if (isError) process.stderr.write(data);
      else process.stdout.write(data);
      
      try {
        let logs = [];
        try { logs = JSON.parse(fs.readFileSync(logFile, 'utf8')); } catch(e) {}
        
        let cls = 'text-outline';
        let isAlert = false;
        if (msg.includes('⚠') || msg.includes('✖') || isError || msg.toLowerCase().includes('error')) {
          cls = 'text-error';
          isAlert = true;
        } else if (name === 'Sentinel') cls = 'text-tertiary';
        else if (name === 'Architect') cls = 'text-primary-container';
        else if (name === 'Healer') cls = 'text-secondary';
        
        const now = new Date();
        const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');
        
        const cleanMsg = msg.replace(/\x1b\[[0-9;]*m/g, '');
        
        logs.push({ time: timeStr, agent: name.toUpperCase(), cls, msg: cleanMsg, alert: isAlert });
        if (logs.length > 100) logs = logs.slice(-100);
        
        const tmp = logFile + '.tmp' + Math.random().toString(36).slice(2);
        fs.writeFileSync(tmp, JSON.stringify(logs));
        fs.renameSync(tmp, logFile);
      } catch(e) {}
    };

    child.stdout.on('data', d => appendLog(d, false));
    child.stderr.on('data', d => appendLog(d, true));

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

// ─── HTTP Management API ────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('Access-Control-Allow-Origin', 'null');  
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  
  if (req.url === '/reheal' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      // Prevent request flooding — max 10KB body
      if (body.length > 10240) {
        res.writeHead(413);
        res.end(JSON.stringify({ error: 'Request too large' }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const queuePath = path.join(sharedDir, 'heal-queue.json');
        const queueData = JSON.parse(fs.readFileSync(queuePath, 'utf8') || '{"queue":[]}');
        
        if (payload.batch) {
          console.log(`\x1b[35m[ORCHESTRATOR] 💊 Full Re-anchor Sweep requested\x1b[0m`);
          const mapStatePath = path.join(sharedDir, 'map-state.json');
          if (fs.existsSync(mapStatePath)) {
            const state = JSON.parse(fs.readFileSync(mapStatePath, 'utf8'));
            const redNodes = state.nodes.filter(n => n.grade === 'red' || (n.score !== null && n.score < 0.4));
            redNodes.forEach(n => {
              queueData.queue.push({ nodeId: n.id, timestamp: new Date().toISOString(), status: 'pending' });
            });
          }
          fs.writeFileSync(queuePath, JSON.stringify(queueData, null, 2));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'batch_queued' }));
        } else {
          const { nodeId } = payload;
          
          // VALIDATE nodeId — prevent path traversal
          if (typeof nodeId !== 'string') {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'nodeId must be string' }));
            return;
          }
          if (nodeId.includes('..') || nodeId.includes('/etc') || 
              nodeId.includes('\\') || nodeId.length > 500) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Invalid nodeId' }));
            return;
          }

          console.log(`\x1b[35m[ORCHESTRATOR] 💊 Manual reheal requested for: ${nodeId}\x1b[0m`);
          queueData.queue.push({ nodeId, timestamp: new Date().toISOString(), status: 'pending' });
          fs.writeFileSync(queuePath, JSON.stringify(queueData, null, 2));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'queued', nodeId }));
        }
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid payload' }));
      }
    });
    return;
  }

  // /health — System status
  if (req.url === '/health' && req.method === 'GET') {
    const mapStatePath = path.join(sharedDir, 'map-state.json');
    let nodeCount = 0;
    try {
       const state = JSON.parse(fs.readFileSync(mapStatePath, 'utf8'));
       nodeCount = state.nodes.length;
    } catch(e) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      nodes: nodeCount,
      port: { ws: config.ports.websocket, http: config.ports.http }
    }));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(API_PORT, () => {
  console.log(`\x1b[36m[ORCHESTRATOR] 🚀 Management API listening on http://localhost:${API_PORT}\x1b[0m`);
});

// ─── Handle unexpected errors ───────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error(`\x1b[31m[ORCHESTRATOR] Uncaught exception: ${err.message}\x1b[0m`);
  agents.forEach(a => { try { a.kill(); } catch(_) {} });
  process.exit(1);
});
