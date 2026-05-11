/**
 * serve.js - local HTTP sidecar for the CodexMap browser UI.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { execFile } = require('child_process');
const { atomicWriteJson, atomicWriteFile, ensureDir, readJsonSafe, safeInside } = require('./lib/atomic');
const { readCostState } = require('./lib/cost');
const { graphPath, projectIndexPath, learnPath } = require('./lib/project-index');

const ROOT = __dirname;
const UI_DIR = path.join(ROOT, 'ui');
const STITCH_DIR = path.join(ROOT, 'stitch_codexmap_codebase_intelligence_dashboard');
const SHARED_DIR = path.resolve(process.env.CODEXMAP_SHARED_DIR || path.join(ROOT, 'shared'));
const OUTPUT_DIR = path.resolve(process.env.CODEXMAP_OUTPUT_DIR || path.join(ROOT, 'output'));
const WORKSPACE_DIR = path.resolve(process.env.CODEXMAP_WORKSPACE_DIR || process.cwd());
const HOST = process.env.CODEXMAP_HOST || '127.0.0.1';
const PORT = Number(process.env.CODEXMAP_HTTP_PORT || 3333);

const PATHS = {
  mapState: path.join(SHARED_DIR, 'map-state.json'),
  driftLog: path.join(SHARED_DIR, 'session-drift-log.json'),
  healQueue: path.join(SHARED_DIR, 'heal-queue.json'),
  activeWatch: path.join(SHARED_DIR, 'active-watch-path.txt'),
  session: path.join(process.env.CODEXMAP_SESSION_DIR || SHARED_DIR, 'session.json'),
  projectGraph: graphPath(WORKSPACE_DIR),
  projectIndex: projectIndexPath(WORKSPACE_DIR),
  learn: learnPath(WORKSPACE_DIR),
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

ensureDir(SHARED_DIR);
ensureDir(OUTPUT_DIR);
if (!fs.existsSync(PATHS.healQueue)) atomicWriteJson(PATHS.healQueue, { queue: [] });

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function normalizeNodeIds(payload) {
  const ids = [];
  if (payload && typeof payload.nodeId === 'string') ids.push(payload.nodeId);
  if (payload && Array.isArray(payload.nodeIds)) {
    payload.nodeIds.forEach((nodeId) => {
      if (typeof nodeId === 'string') ids.push(nodeId);
    });
  }
  return [...new Set(ids.map((nodeId) => nodeId.trim()).filter(Boolean))];
}

function validateSessionPayload(payload) {
  const expected = process.env.CODEXMAP_SESSION_ID;
  if (!expected) return null;
  if (!payload || payload.sessionId !== expected) {
    return `stale or missing sessionId; expected ${expected}`;
  }
  return null;
}

function enqueueHealRequests(payload) {
  const nodeIds = normalizeNodeIds(payload);
  const batchId = payload.batchId || `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const queueData = readJsonSafe(PATHS.healQueue, { queue: [] });
  if (!Array.isArray(queueData.queue)) queueData.queue = [];

  const queued = [];
  const skipped = [];

  for (const nodeId of nodeIds) {
    const existing = queueData.queue.find((entry) =>
      entry.nodeId === nodeId &&
      (entry.status === 'pending' || entry.status === 'healing')
    );

    if (existing) {
      skipped.push({ nodeId, reason: `already ${existing.status}` });
      continue;
    }

    queueData.queue.push({
      nodeId,
      status: 'pending',
      batchId,
      triggeredBy: payload.triggeredBy || 'manual',
      enqueuedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      attemptCount: 0,
      error: null,
    });
    queued.push(nodeId);
  }

  atomicWriteJson(PATHS.healQueue, queueData);
  return { status: 'queued', batchId, queued, skipped };
}

function getActiveWatchPath() {
  if (fs.existsSync(PATHS.activeWatch)) return fs.readFileSync(PATHS.activeWatch, 'utf8').trim();
  return OUTPUT_DIR;
}

function isLocalRequest(req) {
  const addr = req.socket.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch (_) {
    return false;
  }
}

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*",
    ].join('; ')
  );
}

function serveFile(res, filePath, baseDir) {
  const resolved = path.resolve(filePath);
  if (!safeInside(baseDir, resolved)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      sendText(res, 404, 'Not found');
      return;
    }
    const mime = MIME[path.extname(resolved)] || 'text/plain; charset=utf-8';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

async function handleApi(req, res, pathname, parsed) {
  if (req.method === 'GET' && pathname === '/api/health') {
    const state = readJsonSafe(PATHS.mapState, { nodes: [], edges: [] });
    sendJson(res, 200, {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      sessionId: process.env.CODEXMAP_SESSION_ID || null,
      ports: {
        http: PORT,
        websocket: Number(process.env.CODEXMAP_WS_PORT || process.env.CODEXMAP_PORT || 4242),
      },
      nodes: Array.isArray(state.nodes) ? state.nodes.length : 0,
      engine: process.env.CODEXMAP_ENGINE || 'codex',
      cloudScoring: process.env.CODEXMAP_CLOUD_SCORING !== 'false',
      cost: readCostState(SHARED_DIR),
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/privacy') {
    sendJson(res, 200, {
      cloudScoring: process.env.CODEXMAP_CLOUD_SCORING !== 'false',
      disclosure: process.env.CODEXMAP_CLOUD_SCORING === 'false'
        ? 'Cloud scoring is disabled for this session.'
        : 'Code snippets and summaries may be sent to OpenAI for embedding-based scoring.',
      cost: readCostState(SHARED_DIR),
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/session') {
    sendJson(res, 200, {
      ...readJsonSafe(PATHS.session, {}),
      sessionId: process.env.CODEXMAP_SESSION_ID || null,
      sessionDir: process.env.CODEXMAP_SESSION_DIR || null,
      sharedDir: SHARED_DIR,
      outputDir: OUTPUT_DIR,
      uiUrl: process.env.CODEXMAP_UI_URL || `http://${HOST}:${PORT}`,
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/project-graph') {
    const graph = readJsonSafe(PATHS.projectGraph, null);
    if (!graph) {
      sendJson(res, 404, {
        error: 'project graph not indexed',
        nextStep: 'Run: npx codexmap index',
      });
      return true;
    }
    sendJson(res, 200, graph);
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/project-index') {
    if (!fs.existsSync(PATHS.projectIndex)) {
      sendJson(res, 404, {
        error: 'project index not found',
        nextStep: 'Run: npx codexmap index',
      });
      return true;
    }
    sendText(res, 200, fs.readFileSync(PATHS.projectIndex, 'utf8'), 'text/markdown; charset=utf-8');
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    sendJson(res, 200, readJsonSafe(PATHS.mapState, { version: 1, nodes: [], edges: [], meta: {} }));
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/drift-log') {
    sendJson(res, 200, readJsonSafe(PATHS.driftLog, []));
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/heal-queue') {
    sendJson(res, 200, readJsonSafe(PATHS.healQueue, { queue: [] }));
    return true;
  }

  if (req.method === 'POST' && (pathname === '/api/reheal' || pathname === '/api/reanchor' || pathname === '/reheal' || pathname === '/reanchor')) {
    if (!isAllowedOrigin(req)) {
      sendJson(res, 403, { error: 'origin not allowed' });
      return true;
    }
    try {
      const payload = await readBody(req);
      const sessionError = validateSessionPayload(payload);
      if (sessionError) {
        sendJson(res, 409, { error: sessionError });
        return true;
      }
      const nodeIds = normalizeNodeIds(payload);
      if (nodeIds.length === 0) throw new Error('missing nodeId or nodeIds');
      const result = enqueueHealRequests(payload);
      console.log(`[SERVE] Re-heal queued: ${result.queued.length} queued, ${result.skipped.length} skipped`);
      sendJson(res, 200, {
        ...result,
        nodeId: nodeIds.length === 1 ? nodeIds[0] : undefined,
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  if (req.method === 'GET' && pathname === '/ls') {
    const rawPath = parsed.query.path || WORKSPACE_DIR;
    const resolved = path.resolve(String(rawPath));
    if (!safeInside(WORKSPACE_DIR, resolved)) {
      sendJson(res, 403, { error: 'path is outside the workspace' });
      return true;
    }
    try {
      const items = fs.readdirSync(resolved, { withFileTypes: true })
        .filter((item) => !item.name.startsWith('.') && item.name !== 'node_modules')
        .map((item) => ({
          name: item.name,
          isDir: item.isDirectory(),
          path: path.join(resolved, item.name),
        }));
      sendJson(res, 200, { current: resolved, items });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/set-target') {
    if (!isAllowedOrigin(req)) {
      sendJson(res, 403, { error: 'origin not allowed' });
      return true;
    }
    try {
      const payload = await readBody(req);
      const newPath = path.resolve(String(payload.path || ''));
      if (!safeInside(WORKSPACE_DIR, newPath)) throw new Error('path is outside the workspace');
      if (!fs.existsSync(newPath)) throw new Error('path does not exist');
      atomicWriteFile(PATHS.activeWatch, newPath, 'utf8');
      sendJson(res, 200, { status: 'ok', path: newPath });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  if (req.method === 'GET' && pathname === '/browse') {
    const activePath = getActiveWatchPath();
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    execFile(opener, [activePath], () => {});
    sendJson(res, 200, { status: 'opened', path: activePath });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res);

  if (!isLocalRequest(req)) {
    sendText(res, 403, 'CodexMap only accepts local browser connections by default.');
    return;
  }

  const parsed = url.parse(req.url, true);
  let pathname = decodeURIComponent(parsed.pathname || '/');
  if (pathname === '/') pathname = '/index.html';

  if (pathname.startsWith('/api/') || ['/reheal', '/reanchor', '/ls', '/set-target', '/browse'].includes(pathname)) {
    if (await handleApi(req, res, pathname, parsed)) return;
  }

  if (pathname.startsWith('/project-code/')) {
    const relative = pathname.slice('/project-code/'.length);
    serveFile(res, path.join(OUTPUT_DIR, relative), OUTPUT_DIR);
    return;
  }

  if (pathname.startsWith('/stitch/')) {
    serveFile(res, path.join(STITCH_DIR, pathname.slice('/stitch/'.length)), STITCH_DIR);
    return;
  }

  serveFile(res, path.join(UI_DIR, pathname), UI_DIR);
});

server.listen(PORT, HOST, () => {
  console.log(`CodexMap UI listening on http://${HOST}:${PORT}/?project=CodexMap`);
  console.log(`Session shared state: ${SHARED_DIR}`);
});
