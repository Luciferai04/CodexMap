const fs = require('fs');
const os = require('os');
const path = require('path');
const { atomicWriteJson, atomicWriteFile, ensureDir, readJsonSafe } = require('./atomic');

const STATE_VERSION = 1;

function sessionsRoot(cwd = process.cwd()) {
  return path.join(path.resolve(cwd), '.codexmap', 'sessions');
}

function makeSessionId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${rand}`;
}

function listSessions(cwd = process.cwd()) {
  const root = sessionsRoot(cwd);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const sessionDir = path.join(root, entry.name);
      const meta = readJsonSafe(path.join(sessionDir, 'session.json'), {});
      return {
        id: entry.name,
        dir: sessionDir,
        createdAt: meta.createdAt || null,
        updatedAt: meta.updatedAt || meta.createdAt || null,
        prompt: meta.prompt || '',
      };
    })
    .sort((a, b) => String(b.updatedAt || b.id).localeCompare(String(a.updatedAt || a.id)));
}

function resolveLatestSession(cwd = process.cwd()) {
  return listSessions(cwd)[0] || null;
}

function initializeSharedFiles({ sessionId, sessionDir, sharedDir, outputDir, prompt, autoHeal, cloudScoring, engine, resume, costCapUsd }) {
  ensureDir(sharedDir);
  ensureDir(outputDir);

  const createdAt = new Date().toISOString();
  const initialState = {
    version: STATE_VERSION,
    nodes: [],
    edges: [],
    meta: {
      sessionId,
      prompt,
      engine,
      outputDir,
      createdAt,
    },
  };

  if (!resume || !fs.existsSync(path.join(sharedDir, 'map-state.json'))) {
    atomicWriteJson(path.join(sharedDir, 'map-state.json'), initialState);
    atomicWriteJson(path.join(sharedDir, 'session-drift-log.json'), []);
    atomicWriteJson(path.join(sharedDir, 'drift-history.json'), { snapshots: [] });
    atomicWriteJson(path.join(sharedDir, 'agent-logs.json'), []);
    atomicWriteJson(path.join(sharedDir, 'heal-queue.json'), { queue: [] });
    atomicWriteJson(path.join(sharedDir, 'heal-complete.json'), []);
    atomicWriteJson(path.join(sharedDir, 'collapse-state.json'), { triggered: false, signals: [] });
    atomicWriteJson(path.join(sharedDir, 'arch-health.json'), {});
    atomicWriteJson(path.join(sharedDir, 'api-cost.json'), {
      total_tokens: 0,
      total_cost_usd: 0,
      calls: 0,
      cap_usd: costCapUsd || 5,
      cap_reached: false,
      cloud_scoring_enabled: cloudScoring !== false,
    });
  }

  atomicWriteFile(path.join(sharedDir, 'prompt.txt'), prompt || '', 'utf8');
  atomicWriteJson(path.join(sharedDir, 'settings.json'), {
    autoHeal: !!autoHeal,
    cloudScoring: cloudScoring !== false,
    costCapUsd: costCapUsd || 5,
  });
  atomicWriteJson(path.join(sharedDir, 'tracking.json'), {
    trackedPath: outputDir,
    updatedAt: createdAt,
  });
  atomicWriteJson(path.join(sessionDir, 'session.json'), {
    version: STATE_VERSION,
    id: sessionId,
    prompt,
    engine,
    outputDir,
    sharedDir,
    autoHeal: !!autoHeal,
    cloudScoring: cloudScoring !== false,
    costCapUsd: costCapUsd || 5,
    createdAt,
    updatedAt: createdAt,
    platform: process.platform,
    node: process.version,
    user: os.userInfo().username,
  });
}

function createSession(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const root = sessionsRoot(cwd);
  ensureDir(root);

  let sessionId = options.sessionId;
  let resume = !!options.resume;

  if (options.latest) {
    const latest = resolveLatestSession(cwd);
    if (!latest) throw new Error('No previous CodexMap session found');
    sessionId = latest.id;
    resume = true;
  }

  if (!sessionId) sessionId = makeSessionId();

  const sessionDir = path.join(root, sessionId);
  const sharedDir = path.join(sessionDir, 'shared');
  const outputDir = path.resolve(options.watchPath || options.outputDir || cwd);
  const prompt = options.prompt || readJsonSafe(path.join(sessionDir, 'session.json'), {}).prompt || '';

  ensureDir(sessionDir);
  initializeSharedFiles({
    sessionId,
    sessionDir,
    sharedDir,
    outputDir,
    prompt,
    autoHeal: options.autoHeal,
    cloudScoring: options.cloudScoring,
    costCapUsd: options.costCapUsd,
    engine: options.engine || 'codex',
    resume,
  });

  return {
    id: sessionId,
    cwd,
    root,
    sessionDir,
    sharedDir,
    outputDir,
    prompt,
    resume,
  };
}

module.exports = {
  STATE_VERSION,
  sessionsRoot,
  listSessions,
  resolveLatestSession,
  createSession,
};
