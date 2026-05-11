#!/usr/bin/env node
/**
 * orchestrator.js — Root: spawns and coordinates all 4 CodexMap agents
 * Built by @Somu.ai for the OpenAI Codex Hackathon 2025
 */

const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { atomicWriteJson, atomicWriteFile, ensureDir, readJsonSafe, safeInside } = require('./lib/atomic');

// Config validation
const { config, validate } = require('./config');
const errors = validate();
if (errors.length > 0) {
  console.error('\n❌ CodexMap startup failed:\n');
  errors.forEach(e => console.error(`   • ${e}`));
  console.error('\nFix .env and retry.\n');
  process.exit(1);
}

const sharedDir = path.resolve(process.env.CODEXMAP_SHARED_DIR || path.join(__dirname, 'shared'));

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('[Orchestrator] Uncaught exception:', err.message);
  ensureDir(sharedDir);
  fs.appendFileSync(path.join(sharedDir, 'error.log'), `${new Date().toISOString()} UNCAUGHT: ${err.stack}\n`);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Orchestrator] Unhandled rejection:', reason);
  ensureDir(sharedDir);
  fs.appendFileSync(path.join(sharedDir, 'error.log'), `${new Date().toISOString()} REJECTION: ${reason}\n`);
});

const rawArgs = process.argv.slice(2);
const flags = rawArgs.filter(arg => arg.startsWith('--'));
const posArgs = rawArgs.filter(arg => !arg.startsWith('--'));

const autoHeal = flags.includes('--auto-heal');
const enhancedScoring = flags.includes('--enhanced-scoring');
const usePageIndex = flags.includes('--use-pageindex');
const reload = flags.includes('--reload');
const watchIdx = rawArgs.indexOf('--watch');
const externalWatchPath = watchIdx !== -1 ? rawArgs[watchIdx + 1] : (posArgs.length > 1 ? posArgs[1] : null);

const promptPath = path.join(sharedDir, 'prompt.txt');
const mapStatePath = path.join(sharedDir, 'map-state.json');
const driftLogPath = path.join(sharedDir, 'session-drift-log.json');
const outputDir = externalWatchPath
  ? path.resolve(externalWatchPath)
  : path.resolve(process.env.CODEXMAP_OUTPUT_DIR || path.join(__dirname, 'output'));

let prompt = posArgs[0];
if (!prompt || prompt.startsWith('--')) {
  if (reload && fs.existsSync(promptPath)) {
    prompt = fs.readFileSync(promptPath, 'utf8');
  } else {
    console.error('[ORCHESTRATOR] Missing prompt. Usage: node orchestrator.js "<developer prompt>"');
    process.exit(1);
  }
}

ensureDir(sharedDir);
ensureDir(outputDir);

// Persistence logic
if (reload && fs.existsSync(promptPath)) {
  const existingPrompt = fs.readFileSync(promptPath, 'utf8');
  console.log(`[ORCHESTRATOR] 🔄 Reloading session with prompt: "${existingPrompt.slice(0,50)}..."`);
} else {
  atomicWriteFile(promptPath, prompt, 'utf8');
  // Only wipe state if NOT reloading
  const existingState = readJsonSafe(mapStatePath, {});
  atomicWriteJson(mapStatePath, {
    version: existingState.version || 1,
    nodes: [],
    edges: [],
    meta: {
      ...(existingState.meta || {}),
      sessionId: process.env.CODEXMAP_SESSION_ID || existingState.meta?.sessionId || null,
      prompt,
      engine: process.env.CODEXMAP_ENGINE || existingState.meta?.engine || 'codex',
      outputDir,
      resetAt: new Date().toISOString(),
    },
  });
  atomicWriteJson(driftLogPath, []);
  // Wipe logs too
  const logFile = path.join(sharedDir, 'agent-logs.json');
  atomicWriteJson(logFile, []);
}

// Ensure tracking.json knows about the project path (critical for Healer/Historian)
const trackingPath = path.join(sharedDir, 'tracking.json');
atomicWriteJson(trackingPath, {
  trackedPath: outputDir,
  updatedAt: new Date().toISOString()
});

// Auto-heal settings for Healer agent
const settingsPath = path.join(sharedDir, 'settings.json');
atomicWriteJson(settingsPath, {
  ...readJsonSafe(settingsPath, {}),
  autoHeal,
  cloudScoring: config.runtime.cloudScoring,
});
console.log(`[ORCHESTRATOR] Auto-heal: ${autoHeal ? 'ENABLED' : 'disabled'}`);

const { version } = require('./version');
const agentStatus = {
  Cartographer: false,
  Broadcaster:  false,
  Sentinel:     false,
  Generator:    false,
  Historian:    false,
  Healer:       false
};

function printBanner() {
  process.stdout.write('\x1Bc'); // Clear screen
  console.log(`
\x1b[35m   ⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡
\x1b[35m   ⬡ \x1b[1m\x1b[37mCODEXMAP\x1b[0m\x1b[35m v${version}                           ⬡
\x1b[35m   ⬡ \x1b[37mReal-time codebase intelligence         \x1b[35m⬡
\x1b[35m   ⬡ \x1b[37mBuilt by @Somu.ai                       \x1b[35m⬡
\x1b[35m   ⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡
\x1b[0m`);
  printAgentStatus();
}

function printAgentStatus() {
  const line = [
    agentStatus.Cartographer ? '\x1b[32m🟢 Carto\x1b[0m' : '\x1b[90m⚪ Carto\x1b[0m',
    agentStatus.Broadcaster  ? '\x1b[32m🟢 Broad\x1b[0m' : '\x1b[90m⚪ Broad\x1b[0m',
    agentStatus.Sentinel     ? '\x1b[32m🟢 Senti\x1b[0m' : '\x1b[90m⚪ Senti\x1b[0m',
    agentStatus.Historian    ? '\x1b[32m🟢 Histo\x1b[0m' : '\x1b[90m⚪ Histo\x1b[0m',
    agentStatus.Healer       ? '\x1b[32m🟢 Healer\x1b[0m' : '\x1b[90m⚪ Healer\x1b[0m',
    agentStatus.Generator    ? '\x1b[32m🟢 Gen\x1b[0m'    : '\x1b[90m⚪ Gen\x1b[0m',
  ].join('  ');

  process.stdout.write(`\r  Status: ${line}\x1b[K\n\n`);
}

printBanner();

const agents = [];
const agentNames = ['Cartographer', 'Broadcaster', 'Sentinel', 'Historian', 'Healer', 'Generator'];
const agentPaths = [
  path.join(__dirname, 'agents', 'cartographer.js'),
  path.join(__dirname, 'agents', 'broadcaster.js'),
  path.join(__dirname, 'agents', 'sentinel.js'),
  path.join(__dirname, 'agents', 'historian.js'),
  path.join(__dirname, 'agents', 'healer.js'),
  path.join(__dirname, 'agents', 'generator.js'),
];

const sentinelArgs = [];
if (enhancedScoring) sentinelArgs.push('--enhanced-scoring');
if (usePageIndex) sentinelArgs.push('--use-pageindex');

// Healer agent handles auto-healing via settings.json (no --auto-heal flag needed)

const agentArgs = [
  externalWatchPath ? ['--watch', externalWatchPath] : [],
  [],
  sentinelArgs.concat(externalWatchPath ? ['--watch', externalWatchPath] : []),
  [],
  [],
  externalWatchPath ? ['--watch', externalWatchPath] : [],
];

function forkAgent(agentPath, name, args) {
  const child = fork(agentPath, args, { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });

  // Telemetry logging for UI
  const logFile = path.join(sharedDir, 'agent-logs.json');
  if (!fs.existsSync(logFile)) atomicWriteJson(logFile, []);

  // Throttled log writing to prevent disk thrashing
  let logQueue = [];
  let logWriteTimer = null;

  const appendLog = (data, isError) => {
    const msg = data.toString().trim();
    if (!msg) return;
    if (isError) process.stderr.write(data);
    else process.stdout.write(data);

    const timeStr = new Date().toLocaleTimeString();
    const cleanMsg = msg.replace(/\x1b\[[0-9;]*m/g, '');
    let cls = 'text-outline';
    if (msg.includes('⚠') || msg.includes('✖') || isError || msg.toLowerCase().includes('error')) cls = 'text-error';
    else if (name === 'Sentinel') cls = 'text-tertiary';

    logQueue.push({ time: timeStr, agent: name.toUpperCase(), cls, msg: cleanMsg });
    if (logQueue.length > 50) logQueue = logQueue.slice(-50);

    if (!logWriteTimer) {
      logWriteTimer = setTimeout(() => {
        try {
          // Atomic-ish write: read, merge, slice, write
          let existingLogs = [];
          if (fs.existsSync(logFile)) {
            try {
              existingLogs = JSON.parse(fs.readFileSync(logFile, 'utf8') || '[]');
            } catch(e) { existingLogs = []; }
          }
          let merged = [...existingLogs, ...logQueue].slice(-100);
          atomicWriteJson(logFile, merged);
          logQueue = [];
          logWriteTimer = null;
        } catch(e) { logWriteTimer = null; }
      }, 500); // Batch logs every 500ms
    }
  };

  child.stdout.on('data', d => appendLog(d, false));
  child.stderr.on('data', d => appendLog(d, true));

  child.on('message', (msg) => {
    if (msg.type === 'ready') {
      agentStatus[name] = true;
      printBanner();
    }

    // Forward IPC messages to Broadcaster
    const broadcaster = agents.find((a, idx) => agentNames[idx] === 'Broadcaster');
    if (broadcaster && broadcaster !== child) {
      broadcaster.send(msg);
    }
  });

  child.on('exit', (code, sig) => {
    if (shuttingDown) return;
    if (sig) return; // killed intentionally
    if (code !== 0 && code !== null) {
      console.warn(`[Orchestrator] ${name} crashed (code ${code}), restarting in 2s...`);
      setTimeout(() => {
        const newIdx = agentNames.indexOf(name);
        agents[newIdx] = forkAgent(agentPath, name, args);
      }, 2000);
    }
  });

  return child;
}

agentPaths.forEach((path, i) => {
  agents.push(forkAgent(path, agentNames[i], agentArgs[i]));
});

function startUIServer() {
  const app = express();

  app.use(express.json());

  // Serve ui/ as static files
  app.use(express.static(path.join(__dirname, 'ui')));

  // Serve project source code statically for real-time viewing
  app.use('/project-code', express.static(outputDir));

  // Serve shared/ as read-only API (for drift log, cost, state)
  app.get('/api/state', (req, res) => {
    try {
      const state = JSON.parse(fs.readFileSync(mapStatePath, 'utf8'));
      res.json(state);
    } catch(e) {
      res.status(500).json({ error: 'State not available yet' });
    }
  });

  app.get('/api/drift-log', (req, res) => {
    try {
      const log = JSON.parse(fs.readFileSync(driftLogPath, 'utf8'));
      res.json(log);
    } catch(e) {
      res.json([]);
    }
  });

  app.get('/api/cost', (req, res) => {
    try {
      const costPath = path.join(sharedDir, 'api-cost.json');
      if (!fs.existsSync(costPath)) {
        return res.json({ total_cost_usd: 0, calls: 0, total_tokens: 0 });
      }
      res.json(JSON.parse(fs.readFileSync(costPath, 'utf8')));
    } catch(e) {
      res.json({ total_cost_usd: 0, calls: 0, total_tokens: 0 });
    }
  });

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      agents: agents.length,
      nodes: (() => {
        try {
          return JSON.parse(fs.readFileSync(mapStatePath)).nodes.length;
        } catch { return 0; }
      })()
    });
  });

  // Manual re-anchor endpoint
  app.post('/api/reheal', (req, res) => {
    try {
      const data = req.body;

      if (data.batch) {
        console.log('[ORCHESTRATOR] ↺ Triggering full re-anchor sweep');
        const state = JSON.parse(fs.readFileSync(mapStatePath, 'utf8'));
        const healQueuePath = path.join(sharedDir, 'heal-queue.json');
        const q = { queue: [] };
        state.nodes.forEach(n => {
          q.queue.push({
            nodeId: n.id,
            status: 'pending',
            triggeredBy: 'manual',
            enqueuedAt: new Date().toISOString(),
            attemptCount: 0
          });
        });
        atomicWriteJson(healQueuePath, q);
        res.json({ status: 'healing' });
        return;
      }

      if (!data.nodeId || typeof data.nodeId !== 'string') {
        res.status(400).json({ error: 'Invalid nodeId' });
        return;
      }

      // Check node exists
      const state = JSON.parse(fs.readFileSync(mapStatePath, 'utf8'));
      const node  = state.nodes.find(n => n.id === data.nodeId);
      if (!node) {
        res.status(404).json({ error: 'Node not found' });
        return;
      }

      console.log(`[ORCHESTRATOR] ↺ Re-anchor starting for: ${node.label || data.nodeId}`);

      // Signal sentinel to re-score this node with priority
      const sentinelProcess = agents.find((a, idx) => agentNames[idx] === 'Sentinel');
      if (sentinelProcess) {
        sentinelProcess.send({
          type:   'reanchor',
          nodeId: data.nodeId,
          priority: true,
        });
      }

      // Signal generator to rewrite the file
      const generatorProcess = agents.find((a, idx) => agentNames[idx] === 'Generator');
      if (generatorProcess && node.path) {
        generatorProcess.send({
          type:     'rewrite',
          nodeId:   data.nodeId,
          filePath: node.path || node.id,
          prompt:   `${prompt}\n\nIMPORTANT: The file ${node.path} has drifted from the original architecture. Rewrite it to be fully aligned with: ${prompt}`,
        });
      }

      res.json({ status: 'healing', nodeId: data.nodeId, label: node.label });
    } catch (e) {
      console.error('[ORCHESTRATOR] Reheal error:', e.message);
      res.status(400).json({ error: 'Invalid request' });
    }
  });

  const UI_PORT = config.ports.http || 3000;
  app.listen(UI_PORT, config.runtime.host || '127.0.0.1', () => {
    const url = `http://localhost:${UI_PORT}`;
    console.log(`\n  [ORCHESTRATOR] UI ready: ${url}\n`);

    // Auto-open browser (cross-platform)
    try {
      const opener = process.platform === 'darwin' ? 'open'
                   : process.platform === 'win32'  ? 'start'
                   : 'xdg-open';
      require('child_process').exec(`${opener} "${url}"`);
    } catch (e) {
      console.warn('[ORCHESTRATOR] Could not auto-open browser.');
    }
  });

  return app;
}

// Start the UI server unless the production CLI has launched serve.js.
if (process.env.CODEXMAP_SKIP_UI_SERVER !== '1') {
  startUIServer();
}

// Graceful shutdown sequence
let shuttingDown = false;
async function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[CodexMap] ${sig} — shutting down all agents...`);

  // Kill all agents
  agents.forEach((a) => {
    try { a.kill('SIGINT'); } catch {}
  });

  // Wait a bit for processes to die
  await new Promise(r => setTimeout(r, 500));

  // Final state save
  try {
    const raw = fs.readFileSync(mapStatePath, 'utf8');
    const state = JSON.parse(raw);
    if (state.nodes) {
      atomicWriteJson(mapStatePath, state);
      console.log(`[ORCHESTRATOR] Saved ${state.nodes.length} nodes to state.`);
    }
  } catch(e) {}

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', () => {
  if (!shuttingDown) {
    agents.forEach(a => { try { a.kill('SIGTERM'); } catch {} });
  }
});
