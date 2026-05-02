/**
 * orchestrator.js — Root: spawns and coordinates all 4 CodexMap agents
 * Built by @Somu.ai for the OpenAI Codex Hackathon 2025
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

const sharedDir = path.join(__dirname, 'shared');
const promptPath = path.join(sharedDir, 'prompt.txt');
const mapStatePath = path.join(sharedDir, 'map-state.json');
const driftLogPath = path.join(sharedDir, 'session-drift-log.json');
const outputDir = externalWatchPath ? path.resolve(externalWatchPath) : path.join(__dirname, 'output');

if (!fs.existsSync(sharedDir)) fs.mkdirSync(sharedDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

fs.writeFileSync(promptPath, prompt, 'utf8');
if (!fs.existsSync(mapStatePath)) fs.writeFileSync(mapStatePath, JSON.stringify({ nodes: [], edges: [] }), 'utf8');
if (!fs.existsSync(driftLogPath)) fs.writeFileSync(driftLogPath, JSON.stringify([]), 'utf8');

const { version } = require('./version');
console.log(`
╔═══════════════════════════════════════╗
║  CodexMap v${version}                   ║
║  Real-time codebase intelligence      ║
║  by @Somu.ai                          ║
╚═══════════════════════════════════════╝
`);

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
  externalWatchPath ? ['--watch', externalWatchPath] : [],
  [],
  sentinelArgs.concat(externalWatchPath ? ['--watch', externalWatchPath] : []),
  [],
  [],
  [],
  externalWatchPath ? ['--watch', externalWatchPath] : [],
];

function forkAgent(agentPath, name, args) {
  const child = fork(agentPath, args, { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  
  // Telemetry logging for UI
  const logFile = path.join(sharedDir, 'agent-logs.json');
  if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, JSON.stringify([]));

  const appendLog = (data, isError) => {
    const msg = data.toString().trim();
    if (!msg) return;
    if (isError) process.stderr.write(data);
    else process.stdout.write(data);
    
    try {
      let logs = JSON.parse(fs.readFileSync(logFile, 'utf8') || '[]');
      let cls = 'text-outline';
      if (msg.includes('⚠') || msg.includes('✖') || isError || msg.toLowerCase().includes('error')) cls = 'text-error';
      else if (name === 'Sentinel') cls = 'text-tertiary';
      const timeStr = new Date().toLocaleTimeString();
      const cleanMsg = msg.replace(/\x1b\[[0-9;]*m/g, '');
      logs.push({ time: timeStr, agent: name.toUpperCase(), cls, msg: cleanMsg });
      if (logs.length > 50) logs = logs.slice(-50);
      fs.writeFileSync(logFile, JSON.stringify(logs));
    } catch(e) {}
  };

  child.stdout.on('data', d => appendLog(d, false));
  child.stderr.on('data', d => appendLog(d, true));
  
  child.on('exit', (code) => {
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

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/health') {
    res.end(JSON.stringify({ status: 'ok', agents: agents.length }));
  } else if (req.url === '/reheal' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const healQueuePath = path.join(sharedDir, 'heal-queue.json');
        const q = JSON.parse(fs.readFileSync(healQueuePath, 'utf8') || '{"queue":[]}');
        
        if (data.batch) {
          // Trigger full sweep (placeholder logic)
          console.log('[ORCHESTRATOR] ↺ Triggering full re-anchor sweep');
        } else if (data.nodeId) {
          q.queue.push({
            nodeId: data.nodeId,
            status: 'pending',
            triggeredBy: 'manual',
            enqueuedAt: new Date().toISOString(),
            reanchorOutputFlag: true
          });
          fs.writeFileSync(healQueuePath, JSON.stringify(q, null, 2));
          console.log(`[ORCHESTRATOR] ↺ Enqueued heal for ${data.nodeId}`);
        }
        res.end(JSON.stringify({ status: 'healing' }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(config.ports.http, () => {
  console.log(`[ORCHESTRATOR] Management API: http://localhost:${config.ports.http}`);
  console.log(`[ORCHESTRATOR] Open ui/index.html to view the map.`);
});

process.on('SIGINT', () => {
  agents.forEach(a => a.kill());
  process.exit(0);
});
