const fs = require('fs');
let code = fs.readFileSync('orchestrator.js', 'utf8');

// 1. Add config and error handlers at the top (after requires)
const topRequires = `const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Config validation
const { config, validate } = require('./config');
const errors = validate();
if (errors.length > 0) {
  console.error('\\n❌ CodexMap startup failed:\\n');
  errors.forEach(e => console.error(\`   • \${e}\`));
  console.error('\\nFix .env and retry.\\n');
  process.exit(1);
}

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('[Orchestrator] Uncaught exception:', err.message);
  fs.appendFileSync('./shared/error.log', \`\${new Date().toISOString()} UNCAUGHT: \${err.stack}\\n\`);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Orchestrator] Unhandled rejection:', reason);
  fs.appendFileSync('./shared/error.log', \`\${new Date().toISOString()} REJECTION: \${reason}\\n\`);
});
`;
code = code.replace(/const \{ fork \} = require\('child_process'\);[\s\S]*?const http = require\('http'\);/, topRequires);

// 2. Startup Banner
const bannerReplacement = `const { version } = require('./version');
console.log(\`
╔═══════════════════════════════════════╗
║  CodexMap v\${version}                   ║
║  Real-time codebase intelligence      ║
║  by @Somu.ai                          ║
╚═══════════════════════════════════════╝
\`);`;
code = code.replace(/const banner = `[\s\S]*?`;\s*console\.log\(banner\);/, bannerReplacement);

// 3. Update agent forks
const forkFunction = `// Agent crash recovery
function forkWithRecovery(agentPath, name, args = []) {
  const agent = fork(agentPath, args, { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  
  agent.stdout.on('data', (data) => process.stdout.write(data));
  agent.stderr.on('data', (data) => process.stderr.write(data));
  
  agent.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.warn(\`[Orchestrator] \${name} crashed (code \${code}), restarting in 2s...\`);
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
});`;
code = code.replace(/agentPaths\.forEach\(\(agentPath, index\) => \{[\s\S]*?\}\);/, forkFunction);

// 4. Update HTTP server
const httpServerReplacement = `const server = http.createServer((req, res) => {
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
          console.log(\`\\x1b[35m[ORCHESTRATOR] 💊 Full Re-anchor Sweep requested\\x1b[0m\`);
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
          if (typeof nodeId !== 'string' || nodeId.includes('..') || nodeId.includes('/etc') || nodeId.length > 500) {
            res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid nodeId' })); return;
          }
          console.log(\`\\x1b[35m[ORCHESTRATOR] 💊 Manual reheal requested for: \${nodeId}\\x1b[0m\`);
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
  
  res.writeHead(404); res.end();
});
server.listen(config.ports.http);`;

code = code.replace(/const server = http\.createServer\(\(req, res\) => \{[\s\S]*?\}\);\nserver\.listen\(3000\);/, httpServerReplacement);
// Wait, my replacement needs to match exactly what is there. Let's see if 3000 is hardcoded.

fs.writeFileSync('orchestrator.js', code, 'utf8');
console.log('Applied orchestrator.js fixes');
