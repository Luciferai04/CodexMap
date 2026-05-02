/**
 * serve.js — HTTP server for CodexMap UI
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { exec } = require('child_process');

const UI_DIR = path.join(__dirname, 'ui');
const STITCH_DIR = path.join(__dirname, 'stitch_codexmap_codebase_intelligence_dashboard');
const PORT = 3333;

function getActiveWatchPath() {
  const p = path.join(__dirname, 'shared', 'active-watch-path.txt');
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  return path.resolve(__dirname, 'output');
}

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  let pathname = parsed.pathname || '/';
  if (pathname === '/') pathname = '/index.html';

  // Handler for /stitch/... routes
  if (pathname.startsWith('/stitch/')) {
    const relativePath = pathname.replace('/stitch/', '');
    const filePath = path.join(STITCH_DIR, relativePath);
    const ext = path.extname(filePath);
    const mime = MIME[ext] || 'text/plain';

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Stitch file not found: ' + relativePath);
        return;
      }
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    });
    return;
  }

  // Handler for /api/state GET — expose map-state.json
  if (req.method === 'GET' && pathname === '/api/state') {
    const statePath = path.join(__dirname, 'shared', 'map-state.json');
    fs.readFile(statePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('{}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    });
    return;
  }

  // Handler for /api/drift-log GET — expose session-drift-log.json
  if (req.method === 'GET' && pathname === '/api/drift-log') {
    const driftPath = path.join(__dirname, 'shared', 'session-drift-log.json');
    fs.readFile(driftPath, (err, data) => {
      if (err) { res.writeHead(200); res.end('[]'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    });
    return;
  }

  // Handler for /browse GET
  if (req.method === 'GET' && pathname === '/browse') {
    const activePath = getActiveWatchPath();
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${cmd} "${activePath}"`);
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'opened', path: activePath }));
    return;
  }

  // Handler for /ls GET (directory listing)
  if (req.method === 'GET' && pathname === '/ls') {
    const rawPath = parsed.query.path || process.cwd();
    const resolved = path.resolve(rawPath);
    
    try {
      if (!fs.existsSync(resolved)) throw new Error('Path not found');
      const files = fs.readdirSync(resolved, { withFileTypes: true });
      const items = files.map(f => ({
        name: f.name,
        isDir: f.isDirectory(),
        path: path.join(resolved, f.name)
      })).filter(f => !f.name.startsWith('.') && f.name !== 'node_modules'); // Filter junk

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ current: resolved, items }));
    } catch (err) {
      res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Handler for /set-target POST
  if (req.method === 'POST' && pathname === '/set-target') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const newPath = path.resolve(payload.path);
        if (!fs.existsSync(newPath)) throw new Error('Path does not exist');
        
        fs.writeFileSync(path.join(__dirname, 'shared', 'active-watch-path.txt'), newPath, 'utf8');
        console.log(`[SERVE] 🎯 Watch target updated: ${newPath}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', path: newPath }));
      } catch (err) {
        res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Handler for /reheal POST
  if (req.method === 'POST' && pathname === '/reheal') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const nodeId = payload.nodeId;
        console.log(`[SERVE] 💊 Re-heal requested for ${nodeId}`);
        
        const queuePath = path.join(__dirname, 'shared', 'heal-queue.json');
        let queueData = { queue: [] };
        if (fs.existsSync(queuePath)) {
          try {
            queueData = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
          } catch (e) {
            queueData = { queue: [] };
          }
        }
        
        // Match the format healer.js expects
        queueData.queue.push({ 
          nodeId, 
          status: 'pending',
          triggeredBy: 'manual',
          enqueuedAt: new Date().toISOString(),
          attemptCount: 0,
          reanchorOutputFlag: true
        });
        
        fs.writeFileSync(queuePath, JSON.stringify(queueData, null, 2));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'queued', nodeId }));
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON or missing nodeId' }));
      }
    });
    return;
  }

  const filePath = path.join(UI_DIR, pathname);
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found: ' + pathname);
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n🌐 CodexMap UI → http://localhost:${PORT}/?project=CodexMap\n`);
});
