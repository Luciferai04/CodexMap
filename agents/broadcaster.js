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

// ─── Paths ──────────────────────────────────────────────────────────────────
const SHARED_DIR = path.join(__dirname, '..', 'shared');
const MAP_STATE_PATH = path.join(SHARED_DIR, 'map-state.json');
const DRIFT_LOG_PATH = path.join(SHARED_DIR, 'session-drift-log.json');
const GRADE_QUEUE_PATH = path.join(SHARED_DIR, 'grade-queue.json');
const COLLAPSE_STATE_PATH = path.join(SHARED_DIR, 'collapse-state.json');
const GENERATION_DONE_PATH = path.join(SHARED_DIR, 'generation-done.txt');
const HEAL_COMPLETE_PATH = path.join(SHARED_DIR, 'heal-complete.json');

// ─── State ──────────────────────────────────────────────────────────────────
let lastState = null;
let lastDriftLog = [];
let lastCollapseState = null;
let lastHealCompleteCount = 0;
let generationDoneSent = false;
let batchTimer = null;
let pendingDiffs = { nodes: [], edges: [] };

// ─── WebSocket Server on port 4242 ──────────────────────────────────────────
const wss = new WebSocket.Server({ port: 4242 });
console.log('[BROADCASTER] WebSocket server started on ws://localhost:4242');

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
const gradeQueueWatcher = chokidar.watch(GRADE_QUEUE_PATH, {
  persistent: true,
  ignoreInitial: true,
});

gradeQueueWatcher.on('change', () => {
  try {
    const queue = readJsonSafe(GRADE_QUEUE_PATH, []);
    for (const entry of queue) {
      broadcast({
        type: 'node_grade',
        payload: { id: entry.id, grade: entry.grade, score: entry.score },
      });
    }
    // Clear the queue after sending
    const tmpPath = GRADE_QUEUE_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify([]), 'utf8');
    fs.renameSync(tmpPath, GRADE_QUEUE_PATH);
  } catch (err) {
    // Ignore read errors during atomic writes
  }
});

gradeQueueWatcher.on('error', () => {
  // grade-queue.json may not exist yet — that's fine
});

// ─── Watch session-drift-log.json for drift_score messages ──────────────────
chokidar.watch(DRIFT_LOG_PATH, { persistent: true }).on('change', () => {
  const driftLog = readJsonSafe(DRIFT_LOG_PATH, []);
  if (driftLog.length > lastDriftLog.length) {
    // New entries added
    const newEntries = driftLog.slice(lastDriftLog.length);
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

// ─── Initialize lastState ───────────────────────────────────────────────────
lastState = readJsonSafe(MAP_STATE_PATH, { nodes: [], edges: [] });
lastHealCompleteCount = readJsonSafe(HEAL_COMPLETE_PATH, []).length;

console.log('[BROADCASTER] Agent started successfully');
console.log(`[BROADCASTER] Watching: map-state.json, drift-log, grade-queue, collapse-state`);
