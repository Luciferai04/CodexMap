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

// ─── Paths ──────────────────────────────────────────────────────────────────
const SHARED_DIR = path.join(__dirname, '..', 'shared');
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
const wss = new WebSocket.Server({ port: config.ports.websocket, host: '127.0.0.1' });
console.log(`[BROADCASTER] WebSocket server started on ws://localhost:${config.ports.websocket}`);

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
  console.log('[BROADCASTER] Health endpoint → http://localhost:4243/health');
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
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
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

  pendingDiffs = { nodes: [], edges: [] };
  batchTimer = null;
}

// ─── On new client connection: send full_reset ──────────────────────────────
wss.on('connection', (ws, req) => {
  // Only allow connections from localhost
  const origin = req.headers.origin;
  const isLocal = !origin || 
                  origin === 'null' || 
                  origin?.includes('localhost') || 
                  origin?.includes('127.0.0.1') ||
                  origin?.includes('file://');
  
  if (!isLocal) {
    ws.close(1008, 'Only local connections allowed');
    return;
  }

  const clientAddr = req.socket.remoteAddress;
  console.log(`[BROADCASTER] 🔗 New client connected from ${clientAddr} (total: ${wss.clients.size})`);

  // Send full_reset with current state
  const currentState = readJsonSafe(MAP_STATE_PATH, { nodes: [], edges: [] });
  safeSend(ws, { type: 'full_reset', payload: currentState });

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

  // Current heal status
  const healQueue = readJsonSafe(HEAL_QUEUE_PATH, { queue: [] });
  for (const entry of healQueue.queue) {
    if (entry.status === 'healing' || entry.status === 'done' || entry.status === 'failed') {
      safeSend(ws, { type: 'heal_status_update', payload: { nodeId: entry.nodeId, status: entry.status } });
    }
  }

  // Handle incoming UI messages for Self-Healing
  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString().slice(0, 4096));
      
      if (data.type === 'set_autoheal') {
        const settings = readJsonSafe(SETTINGS_PATH, { autoHeal: false });
        settings.autoHeal = !!data.enabled;
        const tmp = SETTINGS_PATH + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(settings));
        fs.renameSync(tmp, SETTINGS_PATH);
        console.log(`[BROADCASTER] Set autoHeal = ${settings.autoHeal}`);
      }
      
      if (data.type === 'manual_heal') {
        const nodeId = data.nodeId;
        if (nodeId) {
          const q = readJsonSafe(HEAL_QUEUE_PATH, { queue: [] });
          // Check if already in queue and not done/failed
          const existing = q.queue.find(e => e.nodeId === nodeId);
          if (existing && existing.status !== 'done' && existing.status !== 'failed') return;
          
          q.queue.push({
            nodeId,
            status: 'pending',
            triggeredBy: 'manual',
            enqueuedAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null,
            attemptCount: 0,
            lastScore: 0, // Mock, Sentinel will re-score
            reanchorOutputFlag: true
          });
          const tmp = HEAL_QUEUE_PATH + '.tmp';
          fs.writeFileSync(tmp, JSON.stringify(q, null, 2));
          fs.renameSync(tmp, HEAL_QUEUE_PATH);
          console.log(`[BROADCASTER] Enqueued manual heal for ${nodeId}`);
        }
      }
      if (data.type === 'request_full_reset') {
        const currentState = readJsonSafe(MAP_STATE_PATH, { nodes: [], edges: [] });
        safeSend(ws, { type: 'full_reset', payload: currentState });
        console.log('[BROADCASTER] Sent full_reset on client request');
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
    }
    lastDriftLog = driftLog;
  }
});

// ─── Watch collapse-state.json ──────────────────────────────────────────────
chokidar.watch(COLLAPSE_STATE_PATH, { persistent: true, ignoreInitial: true }).on('change', () => {
  const collapseState = readJsonSafe(COLLAPSE_STATE_PATH, null);
  if (collapseState && JSON.stringify(collapseState) !== JSON.stringify(lastCollapseState)) {
    broadcast({ type: 'collapse_warning', payload: collapseState });
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
    broadcast({ type: 'heal_status_update', payload: { nodeId: entry.nodeId, status: entry.status } });
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
