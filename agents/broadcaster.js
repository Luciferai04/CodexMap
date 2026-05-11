/**
 * agents/broadcaster.js — Agent A3: WebSocket server for live graph updates
 * Built by @Somu.ai for the OpenAI Codex Hackathon 2025
 *
 * Watches shared/map-state.json for changes, computes diffs, and pushes
 * incremental updates to all connected browser clients over WebSocket.
 * Supports 6 message types: graph_update, node_grade, drift_score,
 * collapse_warning, full_reset, generation_done.
 */

const WebSocket = require('ws');
const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');
const { config } = require('../config');
const { readJsonSafe: readJsonFileSafe, atomicWriteJson, ensureDir } = require('../lib/atomic');

// ─── Paths ──────────────────────────────────────────────────────────────────
const SHARED_DIR = path.resolve(process.env.CODEXMAP_SHARED_DIR || path.join(__dirname, '..', 'shared'));
const MAP_STATE_PATH = path.join(SHARED_DIR, 'map-state.json');
const DRIFT_LOG_PATH = path.join(SHARED_DIR, 'session-drift-log.json');
const GRADE_QUEUE_PATH = path.join(SHARED_DIR, 'grade-queue.json');
const COLLAPSE_STATE_PATH = path.join(SHARED_DIR, 'collapse-state.json');
const GENERATION_DONE_PATH = path.join(SHARED_DIR, 'generation-done.txt');
const HEAL_COMPLETE_PATH = path.join(SHARED_DIR, 'heal-complete.json');

// --- Hackathon extensions ---
const DRIFT_HISTORY_PATH = path.join(SHARED_DIR, 'drift-history.json');
const ARCH_HEALTH_PATH = path.join(SHARED_DIR, 'arch-health.json');
const HEAL_QUEUE_PATH = path.join(SHARED_DIR, 'heal-queue.json');
const SETTINGS_PATH = path.join(SHARED_DIR, 'settings.json');
const AGENT_LOGS_PATH = path.join(SHARED_DIR, 'agent-logs.json');
const SESSION_ID = process.env.CODEXMAP_SESSION_ID || null;
ensureDir(SHARED_DIR);

// ─── State ──────────────────────────────────────────────────────────────────
let lastState = null;
let lastDriftLog = [];
let lastCollapseState = null;
let lastHealCompleteCount = 0;
let lastAgentLogCount = 0;
let generationDoneSent = false;
let batchTimer = null;
let pendingDiffs = { nodes: [], edges: [] };

// ─── WebSocket Server on configured port ──────────────────────────────────
let wss;
try {
  const host = process.env.CODEXMAP_WS_HOST || config.runtime.host || '127.0.0.1';
  wss = new WebSocket.Server({ port: config.ports.websocket, host });

  wss.on('error', (e) => {
    console.error(`[BROADCASTER] ✖ WebSocket server error: ${e.message}`);
    if (e.code === 'EADDRINUSE') {
      console.error(`[BROADCASTER] Port ${config.ports.websocket} is blocked. Retrying later...`);
      setTimeout(() => process.exit(1), 2000);
    }
  });

  console.log(`[BROADCASTER] WebSocket server started on ws://${host}:${config.ports.websocket}`);
} catch (e) {
  console.error(`[BROADCASTER] Failed to start WebSocket server on port ${config.ports.websocket}:`, e.message);
  setTimeout(() => process.exit(1), 5000);
}

// FIX #2: Health endpoint for diagnostics
const http = require('http');
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', clients: wss.clients.size, uptime: process.uptime() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});
healthServer.listen(0, () => {
  console.log('[BROADCASTER] Health endpoint ready');
});

// ─── Safe send helper ───────────────────────────────────────────────────────
function safeSend(client, data) {
  try {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
      return true;
    }
  } catch (err) {
    // Handle closed socket write gracefully (don't crash)
    console.log('[BROADCASTER] ⚠ Failed to send to client (disconnected)');
  }
  return false;
}

function isSessionWriteAllowed(data) {
  if (!SESSION_ID) return true;
  return data && data.sessionId === SESSION_ID;
}

// ─── Broadcast to all connected clients ─────────────────────────────────────
function broadcast(data) {
  let sentCount = 0;
  wss.clients.forEach(client => {
    if (safeSend(client, data)) sentCount++;
  });
  if (sentCount > 0) {
    console.log(`[BROADCASTER] 📡 Sent ${data.type} to ${sentCount} client(s)`);
  }
}

// ─── Read JSON file safely ──────────────────────────────────────────────────
function readJsonSafe(filePath, fallback) {
  return readJsonFileSafe(filePath, fallback);
}

function broadcastActivity(agent, action) {
  broadcast({
    type: 'agent_activity',
    payload: {
      agent,
      action,
      timestamp: new Date().toISOString()
    }
  });
}

// ─── Compute diff between old and new state ─────────────────────────────────
function computeDiff(oldState, newState) {
  const diff = { nodes: [], edges: [] };

  if (!oldState) {
    // Everything is new
    return { nodes: newState.nodes || [], edges: newState.edges || [] };
  }

  // Find changed/added nodes
  const oldNodeMap = new Map((oldState.nodes || []).map(n => [n.id, n]));
  for (const node of (newState.nodes || [])) {
    const oldNode = oldNodeMap.get(node.id);
    if (!oldNode || oldNode.contentHash !== node.contentHash ||
        oldNode.grade !== node.grade || oldNode.score !== node.score) {
      diff.nodes.push(node);
    }
  }

  // Find new edges
  const oldEdgeSet = new Set((oldState.edges || []).map(e => `${e.source}→${e.target}`));
  for (const edge of (newState.edges || [])) {
    if (!oldEdgeSet.has(`${edge.source}→${edge.target}`)) {
      diff.edges.push(edge);
    }
  }

  return diff;
}

// ─── Flush batched diffs ────────────────────────────────────────────────────
function flushBatch() {
  if (pendingDiffs.nodes.length === 0 && pendingDiffs.edges.length === 0) {
    return;
  }

  broadcast({
    type: 'graph_update',
    payload: { nodes: pendingDiffs.nodes, edges: pendingDiffs.edges },
  });

  const addedCount = pendingDiffs.nodes.filter(n => n.type !== 'directory').length;
  if (addedCount > 0) {
    const labels = pendingDiffs.nodes.filter(n => n.type !== 'directory').map(n => n.label).slice(0, 3).join(', ');
    const suffix = addedCount > 3 ? ` (+${addedCount-3} more)` : '';
    broadcastActivity('Cartographer', `Mapped: ${labels}${suffix}`);
  }

  pendingDiffs = { nodes: [], edges: [] };
  batchTimer = null;
}

// ─── On new client connection: send full_reset ──────────────────────────────
wss.on('connection', (ws, req) => {
  const remoteAddress = req.socket.remoteAddress || '';
  const isLocal = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';

  if (!isLocal) {
    ws.close(1008, 'Only local connections allowed');
    return;
  }

  const clientAddr = remoteAddress;
  console.log(`[BROADCASTER] 🔗 New client connected from ${clientAddr} (total: ${wss.clients.size})`);

  // ALWAYS send full_reset to new client — this fixes "Disconnected" on page load
  try {
    const currentState = readJsonSafe(MAP_STATE_PATH, { nodes: [], edges: [] });
    safeSend(ws, { type: 'full_reset', payload: currentState });
  } catch(e) {
    console.warn('[BROADCASTER] Could not send full_reset:', e.message);
  }

  // Send current drift log
  const driftLog = readJsonSafe(DRIFT_LOG_PATH, []);
  if (driftLog.length > 0) {
    const latest = driftLog[driftLog.length - 1];
    safeSend(ws, { type: 'drift_score', payload: latest });
  }

  // --- Hackathon Extensions ---
  const driftHistory = readJsonSafe(DRIFT_HISTORY_PATH, { snapshots: [] });
  safeSend(ws, { type: 'full_drift_history', payload: driftHistory });

  const archHealth = readJsonSafe(ARCH_HEALTH_PATH, {});
  safeSend(ws, { type: 'full_arch_health', payload: archHealth });

  const agentLogs = readJsonSafe(AGENT_LOGS_PATH, []);
  if (agentLogs.length > 0) {
    safeSend(ws, { type: 'agent_logs_full', payload: agentLogs });
  }

  const settings = readJsonSafe(SETTINGS_PATH, { autoHeal: false });
  safeSend(ws, { type: 'settings_update', payload: settings });

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      if (data.type === 'request_full_reset') {
        const state = readJsonSafe(MAP_STATE_PATH, { nodes: [], edges: [] });
        ws.send(JSON.stringify({ type: 'full_reset', payload: state }));
        console.log('[BROADCASTER] ← Sent full_reset on client request');
        broadcastActivity('Broadcaster', 'UI re-synchronized full graph state');
      }
      
      if (data.type === 'set_autoheal') {
        if (!isSessionWriteAllowed(data)) {
          console.warn('[BROADCASTER] Ignoring stale set_autoheal message');
          return;
        }
        const settings = readJsonSafe(SETTINGS_PATH, { autoHeal: false });
        settings.autoHeal = !!data.enabled;
        atomicWriteJson(SETTINGS_PATH, settings);
        console.log(`[BROADCASTER] Set autoHeal = ${settings.autoHeal}`);
        broadcastActivity('Orchestrator', `Auto-Healing ${settings.autoHeal ? 'ENABLED' : 'DISABLED'}`);
      }
      
      if (data.type === 'manual_heal') {
        if (!isSessionWriteAllowed(data)) {
          console.warn('[BROADCASTER] Ignoring stale manual_heal message');
          return;
        }
        const nodeId = data.nodeId;
        if (nodeId) {
          const q = readJsonSafe(HEAL_QUEUE_PATH, { queue: [] });
          if (!q.queue.some(e => e.nodeId === nodeId && e.status !== 'done')) {
            q.queue.push({
              nodeId,
              status: 'pending',
              triggeredBy: 'manual',
              enqueuedAt: new Date().toISOString()
            });
            atomicWriteJson(HEAL_QUEUE_PATH, q);
            broadcastActivity('Sentinel', `Manual re-anchor queued: ${nodeId.split('/').pop()}`);
          }
        }
      }
    } catch (e) {
      console.error('[BROADCASTER] Error parsing incoming message:', e);
    }
  });

  // Send current collapse state
  const collapseState = readJsonSafe(COLLAPSE_STATE_PATH, null);
  if (collapseState) {
    safeSend(ws, { type: 'collapse_warning', payload: collapseState });
  }

  // If generation already done, notify
  if (generationDoneSent || fs.existsSync(GENERATION_DONE_PATH)) {
    safeSend(ws, { type: 'generation_done', payload: {} });
  }

  ws.on('close', () => {
    console.log(`[BROADCASTER] 🔌 Client disconnected (remaining: ${wss.clients.size})`);
  });

  ws.on('error', (err) => {
    console.log(`[BROADCASTER] ⚠ Client error: ${err.message}`);
  });
});

// ─── Watch map-state.json ───────────────────────────────────────────────────
chokidar.watch(MAP_STATE_PATH, { persistent: true }).on('change', () => {
  const newState = readJsonSafe(MAP_STATE_PATH, { nodes: [], edges: [] });

  if (JSON.stringify(newState) === JSON.stringify(lastState)) return;

  const diff = computeDiff(lastState, newState);
  lastState = JSON.parse(JSON.stringify(newState)); // deep copy

  // Skip if diff is empty
  if (diff.nodes.length === 0 && diff.edges.length === 0) return;

  // Batch diffs: wait 500ms after first change before sending (per SKILL.md)
  pendingDiffs.nodes.push(...diff.nodes);
  pendingDiffs.edges.push(...diff.edges);

  if (!batchTimer) {
    batchTimer = setTimeout(flushBatch, 500);
  }
});

// ─── Watch grade-queue.json for node_grade messages ─────────────────────────
/*
// ─── Watch grade-queue.json for node_grade messages ─────────────────────────
const gradeQueueWatcher = chokidar.watch(GRADE_QUEUE_PATH, {
  persistent: true,
  ignoreInitial: true,
});

gradeQueueWatcher.on('change', () => {
  try {
    const queue = readJsonSafe(GRADE_QUEUE_PATH, []);
    if (queue.length === 0) return;
    
    for (const entry of queue) {
      console.log(`[BROADCASTER] 📊 Sending node_grade for ${entry.id}: ${entry.grade} (${entry.score})`);
      broadcast({
        type: 'node_grade',
        payload: { 
          id: entry.id, 
          grade: entry.grade, 
          score: entry.score,
          drift_signals: entry.drift_signals || [],
          scoring_breakdown: entry.scoring_breakdown
        },
      });
    }
    // Clear the queue after sending
    const tmpPath = GRADE_QUEUE_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify([]), 'utf8');
    fs.renameSync(tmpPath, GRADE_QUEUE_PATH);
  } catch (err) {
    console.error(`[BROADCASTER] ✖ Grade queue processing failed: ${err.message}`);
  }
});
*/

/*
gradeQueueWatcher.on('error', () => {
  // grade-queue.json may not exist yet — that's fine
});
*/

// ─── Watch session-drift-log.json for drift_score messages ──────────────────
chokidar.watch(DRIFT_LOG_PATH, { persistent: true, ignoreInitial: true }).on('change', () => {
  const driftLog = readJsonSafe(DRIFT_LOG_PATH, []);
  if (driftLog.length > lastDriftLog.length) {
    // Only send genuinely new entries (max 5 at a time to avoid flood)
    const newEntries = driftLog.slice(lastDriftLog.length).slice(-5);
    for (const entry of newEntries) {
      broadcast({ type: 'drift_score', payload: entry });
      const score = entry.score;
      broadcastActivity('Sentinel', `Drift score: ${score}% ${score > 70 ? '🔴 high' : score > 40 ? '🟡 review' : '🟢 aligned'}`);
    }
    lastDriftLog = driftLog;
  }
});

// ─── Watch collapse-state.json ──────────────────────────────────────────────
chokidar.watch(COLLAPSE_STATE_PATH, { persistent: true, ignoreInitial: true }).on('change', () => {
  const collapseState = readJsonSafe(COLLAPSE_STATE_PATH, null);
  if (collapseState && JSON.stringify(collapseState) !== JSON.stringify(lastCollapseState)) {
    broadcast({ type: 'collapse_warning', payload: collapseState });
    if (collapseState.triggered) {
      broadcastActivity('Sentinel', '⚠ Architectural collapse: ' + (collapseState.signals?.[0] || 'threshold exceeded'));
    }
    lastCollapseState = collapseState;
  }
});

// ─── Watch generation-done.txt for generation_done message ──────────────────
chokidar.watch(GENERATION_DONE_PATH, { persistent: true, ignoreInitial: true }).on('add', () => {
  if (!generationDoneSent) {
    broadcast({ type: 'generation_done', payload: {} });
    generationDoneSent = true;
    console.log('[BROADCASTER] ✔ Generation complete signal sent');
  }
});


const API_COST_PATH = path.join(SHARED_DIR, 'api-cost.json');
chokidar.watch(API_COST_PATH, { persistent: true, ignoreInitial: false }).on('all', () => {
  try {
    const costData = readJsonSafe(API_COST_PATH, { total_tokens: 0, total_cost_usd: 0 });
    broadcast({ type: 'cost_update', payload: costData });
  } catch(e) {}
});

// ─── Watch heal-complete.json ───────────────────────────────────────────────
chokidar.watch(HEAL_COMPLETE_PATH, { persistent: true, ignoreInitial: true }).on('change', () => {
  const completeArr = readJsonSafe(HEAL_COMPLETE_PATH, []);
  if (completeArr.length > lastHealCompleteCount) {
    const newItems = completeArr.slice(lastHealCompleteCount);
    for (const item of newItems) {
      broadcast({ type: 'heal_complete', payload: item });
    }
    lastHealCompleteCount = completeArr.length;
  }
});

// ─── Hackathon Extensions Watchers ──────────────────────────────────────────
chokidar.watch(DRIFT_HISTORY_PATH, { persistent: true, ignoreInitial: true }).on('change', () => {
  const history = readJsonSafe(DRIFT_HISTORY_PATH, { snapshots: [] });
  broadcast({ type: 'drift_history_update', payload: history });
});

chokidar.watch(ARCH_HEALTH_PATH, { persistent: true, ignoreInitial: true }).on('change', () => {
  const health = readJsonSafe(ARCH_HEALTH_PATH, {});
  broadcast({ type: 'arch_health_update', payload: health });
});

let lastHealQueueStr = '';
chokidar.watch(HEAL_QUEUE_PATH, { persistent: true, ignoreInitial: true }).on('change', () => {
  let qStr = '';
  try { qStr = fs.readFileSync(HEAL_QUEUE_PATH, 'utf8'); } catch(e) { return; }
  if (qStr === lastHealQueueStr) return;
  lastHealQueueStr = qStr;
  
  const q = readJsonSafe(HEAL_QUEUE_PATH, { queue: [] });
  for (const entry of q.queue) {
    // Broadcast status for all items to keep UI in sync
    broadcast({
      type: 'heal_status_update',
      payload: {
        nodeId: entry.nodeId,
        status: entry.status,
        batchId: entry.batchId,
        attemptCount: entry.attemptCount || 0,
        startedAt: entry.startedAt,
        completedAt: entry.completedAt,
        enqueuedAt: entry.enqueuedAt,
        triggeredBy: entry.triggeredBy,
        error: entry.error || entry.lastError,
      }
    });
  }
});

chokidar.watch(AGENT_LOGS_PATH, { persistent: true }).on('change', () => {
  const agentLogs = readJsonSafe(AGENT_LOGS_PATH, []);
  if (agentLogs.length > lastAgentLogCount) {
    const newLogs = agentLogs.slice(lastAgentLogCount);
    for (const log of newLogs) {
      broadcast({ type: 'agent_log', payload: log });
    }
    lastAgentLogCount = agentLogs.length;
  }
});

// ─── Initialize lastState ───────────────────────────────────────────────────
lastState = readJsonSafe(MAP_STATE_PATH, { nodes: [], edges: [] });
lastDriftLog = readJsonSafe(DRIFT_LOG_PATH, []);
lastHealCompleteCount = readJsonSafe(HEAL_COMPLETE_PATH, []).length;
lastAgentLogCount = readJsonSafe(AGENT_LOGS_PATH, []).length;

console.log('[BROADCASTER] Agent started successfully');
console.log(`[BROADCASTER] Watching: map-state.json, drift-log, grade-queue, collapse-state, drift-history, arch-health, heal-queue, agent-logs`);

// Handle incoming IPC messages from Orchestrator
process.on('message', (msg) => {
  if (msg && msg.type) {
    broadcast(msg);

    // Enhanced descriptive activity logs
    if (msg.type === 'node_grade') {
      const { id, grade, score } = msg.payload;
      const fileName = id.split('/').pop();
      const scoreVal = (score || 0).toFixed(2);
      broadcastActivity('Sentinel', `Scored ${fileName} → ${grade} (${scoreVal})`);
    }
    if (msg.type === 'generation_done') {
      broadcastActivity('Generator', 'Codex expansion complete. Architecture stabilized.');
    }
    if (msg.type === 'heal_progress') {
      const { label, attempt } = msg.payload || {};
      const name = label || msg.payload?.nodeId?.split('/').pop() || 'node';
      broadcastActivity('Healer', `Rewriting ${name}${attempt ? ` (attempt ${attempt})` : ''}...`);
    }
    if (msg.type === 'heal_complete') {
      const { label, grade, improved } = msg.payload || {};
      const name = label || msg.payload?.nodeId?.split('/').pop() || 'node';
      const icon = improved ? '✅' : '⚠';
      broadcastActivity('Healer', `${icon} ${name} → ${grade}`);
    }
  }
});

process.on('SIGINT', () => {
  console.log('[BROADCASTER] SIGINT received. Shutting down...');
  process.exit(0);
});

// Signal readiness to Orchestrator
if (process.send) {
  process.send({ type: 'ready' });
}
