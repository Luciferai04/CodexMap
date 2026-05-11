/**
 * agents/healer.js — Agent A6: Self-healing for red nodes
 *
 * Watches heal-queue.json for pending entries, uses Codex CLI to rewrite
 * drifted files, sends IPC notifications for UI updates, and writes
 * heal-complete.json for Broadcaster to push to clients.
 */

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { getEngine } = require('../engines');
const { atomicWriteJson: writeJsonAtomically, readJsonSafe: readJsonAtomicallySafe, ensureDir } = require('../lib/atomic');

console.log('[HEALER] Agent started');

const ROOT = path.resolve(__dirname, '..');
const SHARED_DIR = path.resolve(process.env.CODEXMAP_SHARED_DIR || path.join(ROOT, 'shared'));
const QUEUE_PATH = path.join(SHARED_DIR, 'heal-queue.json');
const COMPLETE_PATH = path.join(SHARED_DIR, 'heal-complete.json');
const PROMPT_PATH = path.join(SHARED_DIR, 'prompt.txt');
const SETTINGS_PATH = path.join(SHARED_DIR, 'settings.json');
const STATE_PATH = path.join(SHARED_DIR, 'map-state.json');
const TRACKING_PATH = path.join(SHARED_DIR, 'tracking.json');
ensureDir(SHARED_DIR);

const MAX_ATTEMPTS = 3;
let healing = false;

// Notify orchestrator that we are ready
if (process.send) {
  process.send({ type: 'ready' });
}

function safeReadJson(filePath, fallback) {
  return readJsonAtomicallySafe(filePath, fallback);
}

function atomicWriteJson(filePath, value) {
  writeJsonAtomically(filePath, value);
}

function getTrackedDir() {
  const tracking = safeReadJson(TRACKING_PATH, {});
  if (tracking && typeof tracking.trackedPath === 'string' && tracking.trackedPath.trim()) {
    return path.resolve(String(tracking.trackedPath).trim());
  }
  return path.resolve(process.env.CODEXMAP_OUTPUT_DIR || path.join(ROOT, 'output'));
}

function getNodeInfo(nodeId) {
  const state = safeReadJson(STATE_PATH, { nodes: [] });
  return state.nodes.find(n => n.id === nodeId) || null;
}

function normalizeNodeFileId(nodeId, nodeInfo = null) {
  const candidate = nodeInfo?.path || nodeInfo?.filePath || nodeId;
  return String(candidate || '').split('::')[0];
}

function isInternalNode(nodeId, nodeInfo = null) {
  const candidate = normalizeNodeFileId(nodeId, nodeInfo).replace(/\\/g, '/');
  return (
    candidate === '.codexmap' ||
    candidate.startsWith('.codexmap/') ||
    candidate.includes('/.codexmap/') ||
    candidate.includes('/node_modules/') ||
    candidate.includes('/.git/')
  );
}

function resolveFilePath(nodeId, nodeInfo = null) {
  const trackedDir = getTrackedDir();
  const fileId = normalizeNodeFileId(nodeId, nodeInfo);
  if (path.isAbsolute(fileId)) return fileId;
  return path.join(trackedDir, fileId);
}

function buildHealPrompt(nodeId, originalPrompt, existingCode, nodeInfo = null) {
  const trackedDir = getTrackedDir();
  let relativeId = normalizeNodeFileId(nodeId, nodeInfo);
  if (path.isAbsolute(relativeId)) {
    relativeId = path.relative(trackedDir, relativeId);
  }

  return `
The file at ${relativeId} has drifted from the original intent of this project.
Original project prompt: ${originalPrompt}

The current file content is:
\`\`\`
${existingCode ? existingCode.substring(0, 4000) : '<empty or missing>'}
\`\`\`

Rewrite the ENTIRE file at ${relativeId} so that it strictly and completely fulfills the responsibilities
described in the original prompt above. Rules:
- Do not add features, classes, or functions not described in the original prompt.
- Do not change any other files.
- Preserve the programming language and file extension.
- Output only the rewritten file using the file edit/update tool.

CRITICAL: You MUST use the file update/edit tools to create and modify files. DO NOT use the exec tool or shell commands (like mkdir or touch), as they will fail due to a known sandbox bug.
`.trim();
}

function sendIPC(type, payload) {
  if (process.send) {
    process.send({ type, payload });
  }
}

function writeHealComplete(result) {
  const complete = safeReadJson(COMPLETE_PATH, []);
  complete.push(result);
  atomicWriteJson(COMPLETE_PATH, complete);
}

function findNextPending(queue) {
  return queue.queue.find((entry) =>
    entry.status === 'pending' &&
    (entry.attemptCount || 0) < MAX_ATTEMPTS
  );
}

function healNode(entry) {
  return new Promise((resolve) => {
    const nodeInfo = getNodeInfo(entry.nodeId);
    const trackedDir = getTrackedDir();
    const filePath = resolveFilePath(entry.nodeId, nodeInfo);
    const existingCode = nodeInfo?.code || (fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '');
    const originalPrompt = fs.existsSync(PROMPT_PATH) ? fs.readFileSync(PROMPT_PATH, 'utf8').trim() : '';
    const healPrompt = buildHealPrompt(entry.nodeId, originalPrompt, existingCode, nodeInfo);

    console.log(`[HEALER] 🛠 Healing ${entry.nodeId} (attempt ${(entry.attemptCount || 0) + 1}/${MAX_ATTEMPTS})...`);

    // Send IPC heal_progress
    sendIPC('heal_progress', {
      nodeId: entry.nodeId,
      status: 'healing',
      label: (nodeInfo?.label || entry.nodeId.split('/').pop()),
      attempt: (entry.attemptCount || 0) + 1,
    });

    const env = { ...process.env };
    if (!env.OPENAI_API_KEY && env.CODEX_API_KEY) {
      env.OPENAI_API_KEY = env.CODEX_API_KEY;
    }

    const engineName = process.env.CODEXMAP_ENGINE || 'codex';
    const engine = getEngine(engineName);
    const codex = engine.reanchor({
      healPrompt,
      prompt: healPrompt,
      filePath,
      cwd: trackedDir,
      env,
    });

    let stdout = '';
    codex.stdout.on('data', (d) => { stdout += d.toString(); });
    codex.stderr.on('data', (d) => process.stderr.write(`[HEALER-ERR] ${d}`));

    codex.on('close', (code) => {
      const success = code === 0;

      // Read the file after codex potentially modified it
      let newCode = existingCode;
      if (fs.existsSync(filePath)) {
        newCode = fs.readFileSync(filePath, 'utf8');
      }

      console.log(`[HEALER] Finished ${entry.nodeId} with code ${code}`);

      resolve({
        success,
        exitCode: code,
        newCode,
        codeChanged: newCode !== existingCode,
      });
    });

    codex.on('error', (err) => {
      console.error(`[HEALER] ✖ Failed to spawn codex: ${err.message}`);
      resolve({ success: false, exitCode: -1, newCode: existingCode, codeChanged: false });
    });

    // Timeout after 60s
    setTimeout(() => {
      try { codex.kill('SIGTERM'); } catch (_) {}
    }, 60000);
  });
}

async function processQueue() {
  if (healing) return;

  const queue = safeReadJson(QUEUE_PATH, { queue: [] });
  const next = findNextPending(queue);
  if (!next) return;

  const nextNodeInfo = getNodeInfo(next.nodeId);
  if (isInternalNode(next.nodeId, nextNodeInfo)) {
    next.status = 'skipped';
    next.completedAt = new Date().toISOString();
    next.error = 'internal CodexMap runtime files are not healable';
    atomicWriteJson(QUEUE_PATH, queue);
    setTimeout(processQueue, 0);
    return;
  }

  healing = true;
  next.status = 'healing';
  next.startedAt = new Date().toISOString();
  next.attemptCount = (next.attemptCount || 0) + 1;
  atomicWriteJson(QUEUE_PATH, queue);

  const result = await healNode(next);

  // Update queue entry
  const queueAfter = safeReadJson(QUEUE_PATH, { queue: [] });
  const entry = queueAfter.queue.find((item) =>
    item.nodeId === next.nodeId && item.status === 'healing'
  );

  const nodeInfo = getNodeInfo(next.nodeId);
  const label = nodeInfo?.label || next.nodeId.split('/').pop();

  if (entry) {
    if (result.success && result.codeChanged) {
      entry.status = 'done';
      entry.completedAt = new Date().toISOString();

      // Read the actual file to get new code for state update
      const filePath = resolveFilePath(next.nodeId, nodeInfo);
      const freshCode = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : result.newCode;

      // Update map-state.json with new code
      const state = safeReadJson(STATE_PATH, { nodes: [] });
      const node = state.nodes.find(n => n.id === next.nodeId);
      if (node) {
        node.code = freshCode;
        // Trigger re-grade by sentinel on next cycle
        node.grade = 'pending';
        node.score = 0;
      }
      atomicWriteJson(STATE_PATH, state);

      console.log(`[HEALER] ✅ ${next.nodeId} rewritten successfully`);

      // Write heal_complete for Broadcaster
      writeHealComplete({
        nodeId: next.nodeId,
        grade: 'pending',
        score: 0,
        S_final: 0,
        label,
        improved: true,
        timestamp: new Date().toISOString(),
      });

      // Send IPC heal_complete (will be re-graded by Sentinel shortly)
      sendIPC('heal_complete', {
        nodeId: next.nodeId,
        grade: 'pending',
        score: 0,
        S_final: 0,
        label,
        improved: true,
      });
    } else {
      entry.status = 'failed';
      entry.completedAt = new Date().toISOString();

      console.log(`[HEALER] ❌ ${next.nodeId} failed (code=${result.exitCode}, changed=${result.codeChanged})`);

      // Still send heal_complete so UI shows it
      writeHealComplete({
        nodeId: next.nodeId,
        grade: 'red',
        score: nodeInfo?.score || 0,
        S_final: nodeInfo?.score || 0,
        label,
        improved: false,
        timestamp: new Date().toISOString(),
      });

      sendIPC('heal_complete', {
        nodeId: next.nodeId,
        grade: 'red',
        score: nodeInfo?.score || 0,
        S_final: nodeInfo?.score || 0,
        label,
        improved: false,
      });
    }
  }

  atomicWriteJson(QUEUE_PATH, queueAfter);
  healing = false;

  // Small delay before processing next
  setTimeout(processQueue, 2000);
}

function autoEnqueueRedNodes(state) {
  const settings = safeReadJson(SETTINGS_PATH, { autoHeal: false });
  if (!settings.autoHeal) return;

  const queue = safeReadJson(QUEUE_PATH, { queue: [] });
  const now = new Date().toISOString();

  const latestByNode = new Map();
  queue.queue.forEach((entry) => {
    latestByNode.set(entry.nodeId, entry);
  });

  let changed = false;

  (state.nodes || [])
    .filter((node) =>
      node.grade === 'red' &&
      node.type !== 'directory' &&
      node.type !== 'block' &&
      !isInternalNode(node.id, node)
    )
    .forEach((node) => {
      const existing = latestByNode.get(node.id);

      if (!existing) {
        queue.queue.push({
          nodeId: node.id,
          status: 'pending',
          triggeredBy: 'auto',
          enqueuedAt: now,
          startedAt: null,
          completedAt: null,
          attemptCount: 0,
          lastScore: typeof node.score === 'number' ? node.score : 0,
        });
        changed = true;
        return;
      }

      if (existing.status === 'pending' || existing.status === 'healing') {
        return;
      }

      // Re-queue failed items if under max attempts
      if (existing.status === 'failed' && existing.attemptCount < MAX_ATTEMPTS) {
        existing.status = 'pending';
        existing.triggeredBy = 'auto';
        existing.enqueuedAt = now;
        existing.startedAt = null;
        existing.completedAt = null;
        changed = true;
      }
    });

  if (changed) {
    atomicWriteJson(QUEUE_PATH, queue);
  }
}

// Initial setup
if (!fs.existsSync(QUEUE_PATH)) atomicWriteJson(QUEUE_PATH, { queue: [] });
if (!fs.existsSync(SETTINGS_PATH)) atomicWriteJson(SETTINGS_PATH, { autoHeal: false });

const queueWatcher = chokidar.watch(QUEUE_PATH, {
  ignoreInitial: false,
  awaitWriteFinish: true
});

queueWatcher.on('change', processQueue);
queueWatcher.on('add', processQueue);

const stateWatcher = chokidar.watch(STATE_PATH, {
  ignoreInitial: false,
  awaitWriteFinish: true
});

stateWatcher.on('change', () => {
  const state = safeReadJson(STATE_PATH, { nodes: [] });
  autoEnqueueRedNodes(state);
  processQueue();
});

// Handle manual heal requests via IPC
process.on('message', (msg) => {
  if (msg.type === 'heal_node') {
    const queue = safeReadJson(QUEUE_PATH, { queue: [] });
    const existing = queue.queue.find(e => e.nodeId === msg.nodeId && e.status !== 'done');
    if (!existing) {
      queue.queue.push({
        nodeId: msg.nodeId,
        status: 'pending',
        triggeredBy: 'manual',
        enqueuedAt: new Date().toISOString(),
        attemptCount: 0,
      });
      atomicWriteJson(QUEUE_PATH, queue);
      processQueue();
    }
  }
});

processQueue();
