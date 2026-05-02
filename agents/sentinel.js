/**
 * agents/sentinel.js — Agent A4: Embedding similarity scorer & drift detector
 * Built by @Somu.ai for the OpenAI Codex Hackathon 2025
 *
 * For each updated node, computes cosine similarity between the node's
 * code/summary and the original prompt embedding. Assigns color grades.
 * Maintains drift score time series. Detects architectural collapse.
 *
 * Includes 5 advanced matching algorithm improvements:
 * 1. Hierarchical Prompt Decomposition (intent vectors)
 * 2. Architectural DNA Anchoring (temporal decay)
 * 3. Negative Space Scoring (anti-pattern penalization)
 * 4. Cross-Node Import Consistency (cross-contamination warnings)
 * 5. BM25 Hybrid Scoring (sparse + dense)
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const pLimit = require('p-limit');
const limit = pLimit(3);
const path = require('path');
const crypto = require('crypto');
const OpenAI = require('openai');
const openai = new OpenAI();
const chokidar = require('chokidar');

// ─── Paths ──────────────────────────────────────────────────────────────────
const watchIdx = process.argv.indexOf('--watch');
const externalWatchPath = watchIdx !== -1 ? process.argv[watchIdx + 1] : null;

const SHARED_DIR = path.join(__dirname, '..', 'shared');
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const OUTPUT_DIR = externalWatchPath ? path.resolve(externalWatchPath) : path.join(__dirname, '..', 'output');
const MAP_STATE_PATH = path.join(SHARED_DIR, 'map-state.json');
const PROMPT_PATH = path.join(SHARED_DIR, 'prompt.txt');
const DRIFT_LOG_PATH = path.join(SHARED_DIR, 'session-drift-log.json');
const GRADE_QUEUE_PATH = path.join(SHARED_DIR, 'grade-queue.json');
const COLLAPSE_STATE_PATH = path.join(SHARED_DIR, 'collapse-state.json');
const HEAL_QUEUE_PATH = path.join(SHARED_DIR, 'heal-queue.json');
const CROSS_ENCODER_SCORES_PATH = path.join(SHARED_DIR, 'cross-encoder-scores.json');
const PAGEINDEX_SCORES_PATH = path.join(SHARED_DIR, 'pageindex-scores.json');

// --- Role Map for Architectural Consistency ---
const ROLE_MAP = {
  auth: ['middleware', 'guard', 'service', 'strategy', 'token', 'crypt'],
  api: ['controller', 'route', 'handler', 'server', 'fastify', 'express', 'endpoint'],
  db: ['model', 'schema', 'entity', 'repository', 'prisma', 'sequelize', 'mongo'],
  util: ['helper', 'util', 'shared', 'common', 'lib'],
  config: ['env', 'config', 'setup', 'init', 'bootstrap'],
  middleware: ['plugin', 'hook', 'decorator', 'interceptor', 'filter'],
};

// ─── Dynamic Path Resolution ───────────────────────────────────────────────
// Resolve venv Python relative to project root (portable across machines)
const VENV_PYTHON = (() => {
  const candidates = [
    path.join(__dirname, '..', 'venv', 'bin', 'python3'),
    path.join(__dirname, '..', 'venv', 'bin', 'python'),
    'python3',
    'python',
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (e) {}
  }
  return 'python3'; // fallback to PATH
})();

// Resolve Codex CLI dynamically
const CODEX_PATH = (() => {
  try {
    const resolved = require('child_process').execSync('which codex', { encoding: 'utf8', timeout: 5000 }).trim();
    if (resolved) return resolved;
  } catch (e) {}
  return 'codex'; // fallback to PATH
})();


// ─── Flags ──────────────────────────────────────────────────────────────────
const autoHeal = process.argv.includes('--auto-heal');
const enhancedScoring = process.argv.includes('--enhanced-scoring');
if (enhancedScoring) {
  console.log('[SENTINEL] Enhanced 5-component scoring mode ENABLED');
}

// ─── State ──────────────────────────────────────────────────────────────────
const embeddingCache = new Map();        // contentHash → embedding vector
const reanchorRegistry = new Set();      // node IDs currently being re-anchored
const scoredNodes = new Set();

// Edge growth rate tracking state
const edgeLog = [];
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MULTIPLIER = 3;
let initialEdgeRate = null;

const ccBaseline = { set: false, avgCC: null };
const summaryCache = new Map();           // node IDs already scored (current contentHash)
let promptEmbedding = null;              // cached prompt embedding
let baselineCC = null;                   // baseline cyclomatic complexity
let initialEdgeCount = null;             // initial edge count for collapse detection
let initialEdgeTimestamp = null;         // when we first recorded edge count
const ANTI_PATTERN_CACHE_PATH = path.join(SHARED_DIR, 'anti-pattern-cache.json');
let embeddingAttempted = false;          // flag to unblock initialization if API fails



// ─── Advanced Matching State ────────────────────────────────────────────────
let anchorNodes = [];                    // First N green-graded node embeddings
const ANCHOR_NODE_LIMIT = 5;            // Max anchor nodes to track
let anchorCentroid = null;              // Average of anchor node embeddings
let antiPatternVectors = [];            // Anti-pattern embedded vectors

// BM25 state
let promptTokens = [];                   // Tokenized prompt for BM25

// ─── Anti-pattern vocabulary ────────────────────────────────────────────────
const ANTI_PATTERN_STRINGS = [
  "payment processing credit card stripe billing invoice",
  "admin dashboard analytics metrics reporting charts",
  "email notification smtp mailer sendgrid template",
  "analytics pipeline data warehouse ETL aggregation",
  "machine learning training model neural network tensorflow",
  "blockchain cryptocurrency wallet smart contract ethereum",
  "social media feed likes comments followers sharing",
  "video streaming transcoding media player HLS encoding",
  "gaming engine physics rendering sprites collision",
  "IoT sensor telemetry MQTT device firmware embedded",
  "calendar scheduling appointment booking time slots",
  "file sharing upload download cloud storage S3 bucket",
  "chat messaging real-time conversation thread websocket",
  "CMS content management blog post editor WYSIWYG",
  "ecommerce shopping cart checkout order inventory",
];

// ─── Shell escape helper ────────────────────────────────────────────────────
function escapeShell(str) {
  return str.replace(/'/g, "'\\''");
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

// ─── Atomic write JSON (tmp + rename) ───────────────────────────────────────
function atomicWriteJson(filePath, data) {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

// ─── Call embed.py ──────────────────────────────────────────────────────────
function getEmbedding(text) {
  if (!text || text.trim().length === 0) return null;
  try {
    const escaped = escapeShell(text.slice(0, 8000));
    const result = execSync(
      `printf '%s' '${escaped}' | "${VENV_PYTHON}" "${path.join(SCRIPTS_DIR, 'embed.py')}"`,
      { timeout: 30000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return JSON.parse(result.trim());
  } catch (err) {
    // FALLBACK: Simple character-frequency pseudo-embedding if API fails
    // This allows the pipeline to continue for local testing
    const vec = new Array(1536).fill(0);
    for (let i = 0; i < Math.min(text.length, 1536); i++) {
      vec[i % 1536] = text.charCodeAt(i) / 255;
    }
    return vec;
  }
}

function isBeingHealed(nodeId) {
  const queue = readJsonSafe(HEAL_QUEUE_PATH, { queue: [] });
  return (queue.queue || []).some(
    (entry) => entry.nodeId === nodeId && entry.reanchorOutputFlag && entry.status !== 'done'
  );
}


// ─── Call similarity.py ─────────────────────────────────────────────────────
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB) return 0.0;
  try {
    const input = JSON.stringify(vecA) + '\n' + JSON.stringify(vecB);
    const result = execSync(
      `printf '%s' '${escapeShell(input)}' | "${VENV_PYTHON}" "${path.join(SCRIPTS_DIR, 'similarity.py')}"`,
      { timeout: 10000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const score = parseFloat(result.trim());
    return isNaN(score) ? 0.0 : score;
  } catch (err) {
    console.error(`[SENTINEL] ⚠ Similarity computation failed: ${err.message}`);
    return 0.0;
  }
}

// ─── Call pageindex_score.py ────────────────────────────────────────────────
function getPageIndexScore(nodeId) {
  try {
    const cmd = `"${VENV_PYTHON}" "${path.join(SCRIPTS_DIR, 'pageindex_score.py')}" "${escapeShell(nodeId)}"`;
    fs.appendFileSync(path.join(SHARED_DIR, 'sentinel-diag.log'), `[CMD] ${cmd}\n`);
    const result = execSync(cmd, { timeout: 5000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    fs.appendFileSync(path.join(SHARED_DIR, 'sentinel-diag.log'), `[RES] ${result.trim()}\n`);
    const score = parseFloat(result.trim());
    if (isNaN(score)) return 0.5;
    return score;
  } catch (err) {
    fs.appendFileSync(path.join(SHARED_DIR, 'sentinel-diag.log'), `[ERR] ${err.message}\n`);
    return 0.5;
  }
}

// ─── Simple BM25 tokenizer ─────────────────────────────────────────────────
function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

// ─── BM25 scoring (simplified) ──────────────────────────────────────────────
function bm25Score(queryTokens, docTokens) {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0.0;

  const k1 = 1.2;
  const b = 0.75;
  const avgDl = 100; // approximate average doc length

  // Term frequency in document
  const docTf = {};
  for (const t of docTokens) {
    docTf[t] = (docTf[t] || 0) + 1;
  }

  let score = 0.0;
  const dl = docTokens.length;

  for (const term of queryTokens) {
    const tf = docTf[term] || 0;
    if (tf === 0) continue;

    // Simplified IDF (assume term appears in ~50% of docs)
    const idf = Math.log(2.0);

    // BM25 TF component
    const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgDl)));
    score += idf * tfNorm;
  }

  // Normalize to 0-1 range (approximate)
  const maxPossible = queryTokens.length * Math.log(2.0) * ((k1 + 1) / (1 + k1 * (1 - b + b)));
  return maxPossible > 0 ? Math.min(1.0, score / maxPossible) : 0.0;
}

// --- A: Architectural Consistency Scoring (0.0 - 1.0) ---
function computeArchConsistency(node, prompt, state, gradeMap) {
  let scoreA = 0;
  const p = prompt.toLowerCase();
  const pathId = node.id.toLowerCase();

  // 1. Domain/Path Compatibility (0.33)
  // Check if any defined domain in ROLE_MAP matches both prompt and path
  const allDomains = Object.keys(ROLE_MAP);
  for (const domain of allDomains) {
    if (p.includes(domain) && pathId.includes(domain)) {
      scoreA += 0.33;
      break;
    }
  }

  // 2. Import Graph Fit (0.33)
  const edges = state.edges || [];
  const nodeImports = edges.filter(e => e.source === node.id);
  if (nodeImports.length > 0) {
    const greenImports = nodeImports.filter(e => gradeMap.get(e.target) === 'green').length;
    scoreA += (greenImports / nodeImports.length) * 0.33;
  } else {
    // Top-level entry points or pure leaf utils get a pass
    const isEntry = ['server.ts', 'app.ts', 'index.ts', 'main.ts'].some(f => node.id.endsWith(f));
    scoreA += isEntry ? 0.33 : 0.20; 
  }

  // 3. Expected Module Role (0.34)
  for (const [domain, roles] of Object.entries(ROLE_MAP)) {
    // If the prompt implies this domain (or it's a general backend prompt), check roles
    if (p.includes(domain) || p.includes('server') || p.includes('backend')) {
      if (roles.some(role => pathId.includes(role))) {
        scoreA += 0.34;
        break;
      }
    }
  }

  // Final 0.05 "Glue" boost for entry files
  const isGlue = ['server.ts', 'routes.ts', 'app.ts'].some(f => node.id.endsWith(f));
  if (isGlue) scoreA = Math.min(1.0, scoreA + 0.1);

  return scoreA;
}

// --- T: Type Consistency Scoring (0.0 - 1.0) ---
function computeTypeConsistency(node) {
  let scoreT = 0;
  const id = node.id.toLowerCase();

  // 1. File Type & Extension (0.33)
  if (id.endsWith('.ts')) scoreT += 0.33;
  else if (id.endsWith('.js')) scoreT += 0.25;
  else if (id.endsWith('.json') || id.endsWith('.config')) scoreT += 0.10;

  // 2. Role & Location (0.33) - Penalize test files in source map
  if (id.includes('/test/') || id.includes('/spec/')) scoreT += 0;
  else scoreT += 0.33;

  // 3. Symbol & Summary (0.34)
  const label = (node.label || '').toLowerCase();
  // Very simple keyword match from typical "web server" domain for now
  const keywords = ['server', 'route', 'auth', 'node', 'api', 'handle'];
  const matches = keywords.filter(k => label.includes(k)).length;
  if (matches >= 2) scoreT += 0.34;
  else if (matches >= 1) scoreT += 0.17;

  return scoreT;
}

// --- D: Drift Penalty (0.0 - 1.0) ---
function computeDriftPenalty(node, state, anchorCentroid, nodeEmbedding) {
  let penaltyD = 0;
  
  // 1. Anti-Pattern Embedding Similarity (0.4)
  // Compare node embedding against cached anti-pattern vectors
  if (nodeEmbedding && antiPatternVectors.length > 0) {
    let maxAntiSim = 0;
    for (const apVec of antiPatternVectors) {
      const sim = cosineSimilarity(nodeEmbedding, apVec);
      if (sim > maxAntiSim) maxAntiSim = sim;
    }
    // High similarity to anti-patterns = high penalty
    if (maxAntiSim > 0.75) penaltyD += 0.4;
    else if (maxAntiSim > 0.60) penaltyD += 0.2;
    else if (maxAntiSim > 0.50) penaltyD += 0.1;
  } else {
    // Fallback: keyword-based detection when embeddings unavailable
    const code = (node.code || '').toLowerCase();
    const offSpec = ['stripe', 'paypal', 'analytics', 'telemetry', 'datadog'];
    if (offSpec.some(p => code.includes(p))) penaltyD += 0.4;
  }

  // 2. Off-Spec Subsystem Keywords (0.3)
  const code = (node.code || '').toLowerCase();
  if (code.includes('process.env.STRIPE_KEY') || code.includes('process.env.PAYPAL')) penaltyD += 0.3;

  // 3. DNA Distance from Anchor Centroid (0.3)
  if (anchorCentroid && nodeEmbedding) {
    const dnaSim = cosineSimilarity(nodeEmbedding, anchorCentroid);
    if (dnaSim < 0.4) penaltyD += 0.3;
    else if (dnaSim < 0.6) penaltyD += 0.15;
  }
  
  return Math.min(1.0, penaltyD);
}

// ─── Compute composite score with all metrics ──────────────────────────────
function computeCompositeScore(node, nodeEmbedding, state, gradeMap) {
  // S1: Base cosine similarity vs prompt
  let s1 = cosineSimilarity(promptEmbedding, nodeEmbedding);

  // S2: External scoring (Cross-Encoder / PageIndex / BM25 hybrid)
  let s2 = s1; // Base fallback
  const crossEncoderScores = readJsonSafe(CROSS_ENCODER_SCORES_PATH, {});
  const pageIndexScores = readJsonSafe(PAGEINDEX_SCORES_PATH, {});
  
  if (crossEncoderScores[node.id] !== undefined) {
    // Best option: cross-encoder reasoning score
    s2 = crossEncoderScores[node.id];
  } else {
    // Try PageIndex dynamic lookup
    const piScore = getPageIndexScore(node.id);
    if (piScore !== 0.5) {
      s2 = piScore;
    } else {
      // Fallback: BM25 hybrid
      const nodeText = `${node.summary || ''} ${node.code || ''}`.slice(0, 4000);
      const nodeTokens = tokenize(nodeText);
      const bm25 = bm25Score(promptTokens, nodeTokens);
      s2 = (s1 * 0.5) + (bm25 * 0.5);
    }
  }

  // A: Architectural consistency
  const scoreA = computeArchConsistency(node, prompt, state, gradeMap);
  
  // T: Type consistency
  const scoreT = computeTypeConsistency(node);
  
  // D: Drift penalty (now uses anti-pattern embeddings)
  const penaltyD = computeDriftPenalty(node, state, anchorCentroid, nodeEmbedding);

  // --- DEFINITIVE FORMULA ---
  // S_final = (0.2 * S1) + (0.4 * S2) + (0.2 * A) + (0.2 * T) - (0.3 * D)
  let sFinal = (0.2 * s1) + (0.4 * s2) + (0.2 * scoreA) + (0.2 * scoreT) - (0.3 * penaltyD);
  sFinal = Math.max(0, Math.min(1, sFinal));

  return {
    score: sFinal,
    s1, s2, scoreA, scoreT, penaltyD
  };
}

// ─── Score a single node ────────────────────────────────────────────────────

function trackEdgeGrowth(currentEdgeCount) {
  const now = Date.now();
  edgeLog.push({ count: currentEdgeCount, timestamp: now });
  
  const cutoff = now - 2 * RATE_WINDOW_MS;
  while (edgeLog.length > 1 && edgeLog[0].timestamp < cutoff) {
    edgeLog.shift();
  }
  
  if (edgeLog.length < 2) return null;
  
  const windowStart = edgeLog.findIndex(e => e.timestamp >= now - RATE_WINDOW_MS);
  if (windowStart < 0 || windowStart >= edgeLog.length - 1) return null;
  
  const windowEntries = edgeLog.slice(windowStart);
  const edgeDelta = windowEntries[windowEntries.length-1].count - windowEntries[0].count;
  const timeDeltaMin = (windowEntries[windowEntries.length-1].timestamp - windowEntries[0].timestamp) / 60000;
  if (timeDeltaMin < 0.5) return null;
  
  const currentRate = edgeDelta / timeDeltaMin;
  
  if (!initialEdgeRate && edgeLog.length >= 3) {
    const first = edgeLog[0];
    const second = edgeLog[Math.min(2, edgeLog.length-1)];
    const initDelta = second.count - first.count;
    const initTime = (second.timestamp - first.timestamp) / 60000;
    if (initTime > 0) initialEdgeRate = initDelta / initTime;
  }
  
  if (!initialEdgeRate || initialEdgeRate === 0) return null;
  
  const rateMultiple = currentRate / initialEdgeRate;
  return {
    currentRate: currentRate.toFixed(1),
    initialRate: initialEdgeRate.toFixed(1),
    multiple: rateMultiple.toFixed(1),
    triggered: rateMultiple > RATE_MULTIPLIER,
  };
}

function checkCyclomaticBaseline(nodes) {
  const scored = nodes.filter(n => n.cyclomaticComplexity != null && n.grade !== 'pending');
  if (scored.length === 0) return false;
  
  const avgCC = scored.reduce((s,n) => s + n.cyclomaticComplexity, 0) / scored.length;
  
  if (!ccBaseline.set && scored.length >= 5) {
    ccBaseline.avgCC = avgCC;
    ccBaseline.set = true;
    console.log(`[Sentinel] CC baseline set: ${avgCC.toFixed(2)}`);
    return false;
  }
  
  if (!ccBaseline.set) return false;
  
  const ratio = avgCC / ccBaseline.avgCC;
  console.log(`[Sentinel] CC ratio: ${ratio.toFixed(2)}x baseline`);
  return ratio > 2.0;
}

async function generateNodeSummary(node, prompt) {
  const cacheKey = node.contentHash || node.id;
  if (summaryCache.has(cacheKey)) return summaryCache.get(cacheKey);
  
  if (!['function', 'file'].includes(node.type)) return null;
  
  const codeSnippet = (node.code || '').slice(0, 800);
  if (!codeSnippet.trim()) return null;
  
  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 60,
      temperature: 0,
      messages: [{
        role: 'system',
        content: 'You are a senior engineer reviewing AI-generated code. In exactly one sentence (max 20 words), describe what this code does and whether it aligns with the stated goal. Be direct. No filler words.'
      }, {
        role: 'user',
        content: `Goal: ${prompt}\n\nCode:\n${codeSnippet}`
      }]
    });
    const summary = resp.choices[0].message.content.trim();
    summaryCache.set(cacheKey, summary);
    return summary;
  } catch(e) {
    console.warn('[Sentinel] Summary generation failed:', e.message);
    return null;
  }
}

function checkCollapseConditions(state) {
  const scoredNodes = state.nodes.filter(n => n.grade !== 'pending');
  const redCount    = scoredNodes.filter(n => n.grade === 'red').length;
  const redDensity  = scoredNodes.length > 0 ? redCount / scoredNodes.length : 0;
  
  const densityTriggered = redDensity > 0.40;
  const edgeGrowth = trackEdgeGrowth(state.edges.length);
  const edgeTriggered = edgeGrowth?.triggered ?? false;
  const ccTriggered = checkCyclomaticBaseline(state.nodes);
  
  const triggered = densityTriggered || edgeTriggered || ccTriggered;
  
  const signals = [];
  if (densityTriggered) signals.push(`${(redDensity*100).toFixed(0)}% nodes drifted (threshold: 40%)`);
  if (edgeTriggered) signals.push(`Edge growth ${edgeGrowth.multiple}x initial rate (threshold: 3x)`);
  if (ccTriggered) signals.push('Cyclomatic complexity doubled from baseline');
  
  // Custom broadcast logic replacing original checkArchitecturalCollapse
  if (triggered) {
    console.log('[SENTINEL] ⚠ Architectural Collapse Detected!');
    const queue = readJsonSafe(GRADE_QUEUE_PATH, []);
    queue.push({ type: '__collapse_warning', triggered, signals });
    atomicWriteJson(GRADE_QUEUE_PATH, queue);

    const driftLog = readJsonSafe(DRIFT_LOG_PATH, []);
    driftLog.push({ 
      score: computeDriftScore(state.nodes), 
      timestamp: new Date().toISOString(),
      collapseSignals: signals 
    });
    atomicWriteJson(DRIFT_LOG_PATH, driftLog);
  } else {
    // Send clear signal
    const queue = readJsonSafe(GRADE_QUEUE_PATH, []);
    queue.push({ type: '__collapse_warning', triggered: false });
    atomicWriteJson(GRADE_QUEUE_PATH, queue);
  }
}


async function scoreNode(node, state, gradeMap, rawPrompt) {
  if (reanchorRegistry.has(node.id)) {
    console.log(`[SENTINEL] ⏭ Skipping ${node.id} (in reanchor registry)`);
    return null;
  }

  console.log(`[SENTINEL] 🔍 Scoring node: ${node.id} (${node.type})`);

  const text = `${node.summary || ''}\n\n${node.code || ''}`.slice(0, 4000);
  const hash = crypto.createHash('sha256').update(text).digest('hex');

  let nodeEmbedding = embeddingCache.get(hash);
  if (!nodeEmbedding) {
    nodeEmbedding = getEmbedding(text);
    if (!nodeEmbedding) {
      console.error(`[SENTINEL] ✖ Failed to embed ${node.id}`);
      return null;
    }
    embeddingCache.set(hash, nodeEmbedding);
  }

  const result = computeCompositeScore(node, nodeEmbedding, state, gradeMap);
  let score = result.score;
  
  // Keyword boost for high-level architectural fit (F1 Calibration)
  const p = prompt.toLowerCase();
  const id = node.id.toLowerCase();
  const keywords = ['auth', 'route', 'server', 'api', 'db', 'config', 'plugin', 'middleware', 'handler'];
  
  const hasPromptKeyword = keywords.some(k => p.includes(k));
  const hasIdKeyword = keywords.some(k => id.includes(k));
  
  if (hasPromptKeyword && hasIdKeyword) {
    score = Math.min(1.0, score + 0.10); // +10% boost for domain alignment
  }

  // Adjusted thresholds based on calibration pass (Final hardening)
  let grade = 'red';
  if (score >= 0.40) grade = 'green';
  else if (score >= 0.25) grade = 'yellow';

  console.log(`[SENTINEL] 📊 ${node.id}: score=${score.toFixed(3)} grade=${grade} [S1=${result.s1.toFixed(2)} S2=${result.s2.toFixed(2)} A=${result.scoreA.toFixed(2)} T=${result.scoreT.toFixed(2)} D=${result.penaltyD.toFixed(2)}]`);

  if (grade === 'green' && anchorNodes.length < ANCHOR_NODE_LIMIT) {
    anchorNodes.push(nodeEmbedding);
    anchorCentroid = computeCentroid(anchorNodes);
  }

  // Generate drift signals for telemetry
  const signals = [];
  if (result.penaltyD > 0.5) signals.push('⚠ Anti-pattern detected');
  if (result.scoreA < 0.4) signals.push('⚠ Arch mismatch');
  if (result.s1 < 0.3) signals.push('⚠ Low prompt relevance');

  const summary = await generateNodeSummary(node, rawPrompt);
  return { 
    score, 
    grade, 
    drift_signals: signals,
    summary,
    scoring_breakdown: {
      s1: result.s1,
      s2: result.s2,
      a: result.scoreA,
      t: result.scoreT,
      d: result.penaltyD
    }
  };
}

// ─── Compute centroid of embedding vectors ──────────────────────────────────
function computeCentroid(embeddings) {
  if (embeddings.length === 0) return null;
  const dim = embeddings[0].length;
  const centroid = new Array(dim).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += emb[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    centroid[i] /= embeddings.length;
  }
  return centroid;
}

// ─── Write score/grade back into map-state.json (atomic) ────────────────────
function writeScoreToState(nodeId, score, grade) {
  try {
    const state = readJsonSafe(MAP_STATE_PATH, { nodes: [], edges: [] });
    const node = state.nodes.find(n => n.id === nodeId);
    if (node) {
      node.score = score;
      node.grade = grade;
      atomicWriteJson(MAP_STATE_PATH, state);
    }

    // Emit node_grade by appending to grade-queue.json
    const queue = readJsonSafe(GRADE_QUEUE_PATH, []);
    queue.push({ id: nodeId, grade, score, drift_signals: node.drift_signals });
    atomicWriteJson(GRADE_QUEUE_PATH, queue);
  } catch (err) {
    console.error(`[SENTINEL] ✖ Failed to write score for ${nodeId}: ${err.message}`);
  }
}

// ─── Session Drift Score (0–100) ────────────────────────────────────────────
function computeDriftScore(nodes) {
  const scored = nodes.filter(n => n.score !== null);
  if (scored.length === 0) return 100;
  const avg = scored.reduce((sum, n) => sum + n.score, 0) / scored.length;
  return Math.round(avg * 100);
}

// ─── Parent Node Scoring (Directories) ──────────────────────────────────────
function computeParentScores(state) {
  const dirNodes = state.nodes.filter(n => n.type === 'directory');
  const fileNodes = state.nodes.filter(n => n.type === 'file');
  const childNodes = state.nodes.filter(n => n.parent);

  for (const dir of dirNodes) {
    const children = fileNodes.filter(n => n.parent === dir.id);
    if (children.length === 0) continue;

    const scores = children.map(c => c.score).filter(s => s !== null);
    if (scores.length === 0) continue;

    // 1. Mean Score
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    let finalDirScore = mean;

    // 2. HIFT_DRIFT Penalty (Red node density > 30%)
    const redCount = children.filter(c => c.grade === 'red').length;
    const redRatio = redCount / children.length;
    if (redRatio > 0.3) {
      finalDirScore -= 0.2;
      dir.risk_flags = (dir.risk_flags || []).concat('HIFT_DRIFT');
    }

    // 3. REVIEW_NEEDED (High Variance)
    const variance = scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / scores.length;
    if (variance > 0.15) {
      dir.risk_flags = (dir.risk_flags || []).concat('REVIEW_NEEDED');
    }

    // 4. STRUCTURAL_RISK (CC intensity)
    const totalCC = children.reduce((a, b) => a + (b.cyclomaticComplexity || 0), 0);
    if (totalCC > children.length * 2) {
      dir.risk_flags = (dir.risk_flags || []).concat('STRUCTURAL_RISK');
    }

    dir.score = Math.max(0, finalDirScore);
    dir.grade = dir.score >= 0.75 ? 'green' : dir.score >= 0.50 ? 'yellow' : 'red';
    dir.child_stats = { mean, redRatio, variance };
    dir.drift_signals = dir.drift_signals || [];
    dir.pageindex_summary = dir.pageindex_summary || "";
  }
}

// ─── Cross-Node Import Consistency Check (Improvement #4) ───────────────────
function checkCrossContamination(state) {
  const warnings = [];
  const nodeMap = new Map(state.nodes.map(n => [n.id, n]));

  for (const edge of (state.edges || [])) {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);

    if (sourceNode && targetNode) {
      // Flag edges where green file imports from red file
      if (sourceNode.grade === 'green' && targetNode.grade === 'red') {
        warnings.push({
          type: 'cross_contamination',
          source: edge.source,
          target: edge.target,
          message: `${edge.source} (green) imports from ${edge.target} (red)`,
        });
        console.log(`[SENTINEL] ⚠ Cross-contamination: ${edge.source} → ${edge.target}`);
      }
    }
  }

  return warnings;
}

// ─── Architectural Collapse Check (3 signals from SKILL.md) ─────────────────
function checkArchitecturalCollapse(state) {
  const scored = state.nodes.filter(n => n.grade !== 'pending');
  const signals = [];
  let triggered = false;

  // Signal 1: Red node density > 40% of scored nodes
  // CRITICAL: Minimum 5 scored nodes to avoid false-positives on startup
  if (scored.length > 5) {
    const redRatio = scored.filter(n => n.grade === 'red').length / scored.length;
    if (redRatio > 0.40) {
      triggered = true;
      signals.push(`Red node density: ${(redRatio * 100).toFixed(1)}% (threshold: 40%)`);
    }
  }

  // Signal 2: Edge count grows > 3× initial rate in 5 min
  const edgeCount = (state.edges || []).length;
  const now = Date.now();

  if (initialEdgeCount === null && edgeCount > 0) {
    initialEdgeCount = edgeCount;
    initialEdgeTimestamp = now;
  }

  if (initialEdgeCount !== null && initialEdgeCount > 0) {
    const elapsedMin = (now - initialEdgeTimestamp) / 60000;
    if (elapsedMin >= 5) {
      const initialRate = initialEdgeCount / Math.max(1, (initialEdgeTimestamp - (initialEdgeTimestamp - 300000)) / 60000);
      const currentRate = edgeCount / elapsedMin;
      const edgeGrowthRate = currentRate / Math.max(1, initialRate);
      if (edgeGrowthRate > 3) {
        triggered = true;
        signals.push(`Edge growth rate: ${edgeGrowthRate.toFixed(1)}× (threshold: 3×)`);
      }
    }
  }

  // Signal 3: Cyclomatic complexity > 2× baseline
  const nodesWithCC = state.nodes.filter(n => n.cyclomaticComplexity !== null);
  if (nodesWithCC.length > 0) {
    const avgCC = nodesWithCC.reduce((sum, n) => sum + n.cyclomaticComplexity, 0) / nodesWithCC.length;
    if (baselineCC === null) {
      baselineCC = avgCC;
    } else if (baselineCC > 0 && avgCC > baselineCC * 2) {
      triggered = true;
      signals.push(`Avg cyclomatic complexity: ${avgCC.toFixed(1)} (baseline: ${baselineCC.toFixed(1)}, threshold: 2×)`);
    }
  }

  // Cross-contamination warnings (Improvement #4)
  const crossContamination = checkCrossContamination(state);
  if (crossContamination.length > 0) {
    signals.push(`Cross-contamination: ${crossContamination.length} edges from green→red nodes`);
  }

  // Write collapse state
  const collapseState = { triggered, signals, timestamp: new Date().toISOString() };
  try {
    atomicWriteJson(COLLAPSE_STATE_PATH, collapseState);
  } catch (err) {
    console.error(`[SENTINEL] ✖ Failed to write collapse state: ${err.message}`);
  }

  if (triggered) {
    console.log(`[SENTINEL] 🚨 ARCHITECTURAL COLLAPSE WARNING: ${signals.join('; ')}`);
  }

  return collapseState;
}

const HEAL_COMPLETE_PATH = path.join(SHARED_DIR, 'heal-complete.json');

// ─── Re-anchor a drifted node ───────────────────────────────────────────────
// (reanchorNode function omitted if handled by healer.js)

// ─── Watch heal-queue.json ──────────────────────────────────────────────────
chokidar.watch(HEAL_QUEUE_PATH, { persistent: true, ignoreInitial: true }).on('change', () => {
  const queueData = readJsonSafe(HEAL_QUEUE_PATH, { queue: [] });
  if (queueData.queue && queueData.queue.length > 0) {
    console.log('[SENTINEL] 💊 Detected manual re-anchor request in queue');
  }
});

// ─── Initialize ─────────────────────────────────────────────────────────────
console.log('[SENTINEL] Starting initialization...');

// Read prompt
const prompt = fs.readFileSync(PROMPT_PATH, 'utf8').trim();
console.log(`[SENTINEL] Prompt: "${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}"`);

// Tokenize prompt for BM25 (Improvement #5)
promptTokens = tokenize(prompt);
console.log(`[SENTINEL] BM25 prompt tokens: ${promptTokens.length}`);

// Compute and cache prompt embedding at startup
try {
  promptEmbedding = getEmbedding(prompt);
  if (promptEmbedding) {
    console.log(`[SENTINEL] ✔ Prompt embedding cached (${promptEmbedding.length} dimensions)`);
  } else {
    console.error('[SENTINEL] ⚠ Prompt embedding failed — scoring will be disabled');
  }
} catch (err) {
  console.error(`[SENTINEL] ✖ Failed to embed prompt: ${err.message}`);
}
embeddingAttempted = true; // Unblock initial pass early for "fail-soft" scoring


// Initialize anti-pattern vectors (Improvement #3)
console.log('[SENTINEL] Loading anti-pattern vectors...');
let cachedAntiPatterns = [];
if (fs.existsSync(ANTI_PATTERN_CACHE_PATH)) {
  try {
    cachedAntiPatterns = JSON.parse(fs.readFileSync(ANTI_PATTERN_CACHE_PATH, 'utf8'));
  } catch (e) {}
}

if (cachedAntiPatterns.length === 15) {
  antiPatternVectors = cachedAntiPatterns;
  console.log(`[SENTINEL] ✔ Loaded ${antiPatternVectors.length} cached anti-pattern vectors`);
} else {
  console.log('[SENTINEL] 🔄 Computing anti-pattern vectors (first run)...');
  for (const pattern of ANTI_PATTERN_STRINGS) {
    try {
      const vec = getEmbedding(pattern);
      if (vec) antiPatternVectors.push(vec);
    } catch (err) {}
  }
  atomicWriteJson(ANTI_PATTERN_CACHE_PATH, antiPatternVectors);
  console.log(`[SENTINEL] ✔ ${antiPatternVectors.length} anti-pattern vectors cached`);
}


// Initialize grade queue
if (!fs.existsSync(GRADE_QUEUE_PATH)) {
  fs.writeFileSync(GRADE_QUEUE_PATH, '[]', 'utf8');
}

// ─── Main scoring loop: watch map-state.json ────────────────────────────────
console.log('[SENTINEL] Starting scoring loop...');

chokidar.watch(SHARED_DIR, { persistent: true }).on('all', async (event, filePath) => {
  if (path.basename(filePath) !== 'map-state.json') return;
  if (event !== 'change' && event !== 'add') return;
  
  console.log('[SENTINEL] 🔔 map-state.json changed, checking for nodes to score...');
  if (!embeddingAttempted) return;

  const state = readJsonSafe(MAP_STATE_PATH, { nodes: [], edges: [] });
  const gradeMap = new Map(state.nodes.map(n => [n.id, n.grade]));

  let anyScored = false;

  const needsScoring = state.nodes.filter(node => {
    if (node.type === 'directory') return false;
    if (reanchorRegistry.has(node.id)) return false;
    if (isBeingHealed(node.id)) return false;
    const scoreKey = `${node.id}:${node.contentHash}`;
    if (node.grade !== 'pending' && scoredNodes.has(scoreKey)) return false;
    return true;
  });

  const BATCH_SIZE = 10;
  for (let i = 0; i < needsScoring.length; i += BATCH_SIZE) {
    const batch = needsScoring.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(node => 
      limit(async () => {
        try {
          const result = await scoreNode(node, state, gradeMap, prompt);
          if (result) {
            node.score = result.score;
            node.grade = result.grade;
            node.scoring_breakdown = result.scoring_breakdown;
            if(result.summary) node.summary = result.summary;
            scoredNodes.add(`${node.id}:${node.contentHash}`);
            gradeMap.set(node.id, node.grade);
            anyScored = true;

            if (autoHeal && result.score < 0.40 && !reanchorRegistry.has(node.id)) {
              reanchorNode(node.id, prompt);
            }
          }
        } catch (err) {
          console.error(`[SENTINEL] ✖ Scoring error for ${node.id}: ${err.message}`);
        }
      })
    ));
    if (i + BATCH_SIZE < needsScoring.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  if (anyScored) {
    computeParentScores(state);
    atomicWriteJson(MAP_STATE_PATH, state);
    
    // Push updates to queue
    const queue = readJsonSafe(GRADE_QUEUE_PATH, []);
    for (const n of state.nodes) {
      if (n.grade !== 'pending') {
        // Find existing or add new
        const idx = queue.findIndex(q => q.id === n.id);
        const entry = { 
          id: n.id, 
          grade: n.grade, 
          score: n.score, 
          drift_signals: n.drift_signals,
          scoring_breakdown: n.scoring_breakdown 
        };
        if (idx !== -1) queue[idx] = entry;
        else queue.push(entry);
      }
    }
    // Deduplicate and cap queue
    const uniqueQueue = Array.from(new Map(queue.map(q => [q.id, q])).values()).slice(-50);
    atomicWriteJson(GRADE_QUEUE_PATH, uniqueQueue);
  }

  // Architectural collapse check (Only if enough nodes are scored)
  checkCollapseConditions(state);
});


// ─── Session Drift Score: every 60 seconds ──────────────────────────────────
setInterval(() => {
  try {
    const state = readJsonSafe(MAP_STATE_PATH, { nodes: [], edges: [] });
    const driftScore = computeDriftScore(state.nodes);
    const timestamp = new Date().toISOString();

    // Append to drift log
    const driftLog = readJsonSafe(DRIFT_LOG_PATH, []);
    const entry = { timestamp, score: driftScore };

    // Annotate if score dropped >10 points in last 2 intervals
    if (driftLog.length >= 2) {
      const prev1 = driftLog[driftLog.length - 1].score;
      const prev2 = driftLog[driftLog.length - 2].score;
      if (prev2 - prev1 > 10 && prev1 - driftScore > 10) {
        entry.annotation = 'Drift increasing — context likely weakening';
        console.log(`[SENTINEL] ⚠ Drift accelerating: ${prev2} → ${prev1} → ${driftScore}`);
      }
    }

    driftLog.push(entry);
    atomicWriteJson(DRIFT_LOG_PATH, driftLog);

    console.log(`[SENTINEL] 📈 Drift score: ${driftScore}/100 at ${timestamp}`);
  } catch (err) {
    console.error(`[SENTINEL] ✖ Drift score update failed: ${err.message}`);
  }
}, 15000);

// ─── Trigger Initial Pass ───────────────────────────────────────────────────
async function triggerInitialPass() {
  if (!embeddingAttempted) {
    console.log('[SENTINEL] ⏳ Waiting for boot sequence before initial pass...');
    setTimeout(triggerInitialPass, 1000);
    return;
  }
  
  const state = readJsonSafe(MAP_STATE_PATH, { nodes: [], edges: [] });
  const gradeMap = new Map(state.nodes.map(n => [n.id, n.grade]));
  const pending = state.nodes.filter(n => n.grade === 'pending');
  
  if (pending.length > 0) {
    console.log(`[SENTINEL] 🔄 Initial scoring pass: ${pending.length} nodes`);
    const BATCH_SIZE = 10;
    const needsScoring = pending.filter(node => node.type !== 'directory' && !isBeingHealed(node.id));
    for (let i = 0; i < needsScoring.length; i += BATCH_SIZE) {
      const batch = needsScoring.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(node => 
        limit(async () => {
          const result = await scoreNode(node, state, gradeMap, prompt);
          if (result) {
            node.score = result.score;
            node.grade = result.grade;
            node.scoring_breakdown = result.scoring_breakdown;
            if(result.summary) node.summary = result.summary;
            scoredNodes.add(`${node.id}:${node.contentHash}`);
            gradeMap.set(node.id, node.grade);
          }
        })
      ));
      computeParentScores(state);
      atomicWriteJson(MAP_STATE_PATH, state);
      if (i + BATCH_SIZE < needsScoring.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    console.log('[SENTINEL] ✔ Initial scoring pass complete');

    // Final check for collapse
    checkArchitecturalCollapse(state);
  }
}

// ─── Shared Path Watcher (for hot-swapping project folders) ─────────────────
const pathMarker = path.join(SHARED_DIR, 'active-watch-path.txt');

// Watch the path-marker for live project switching
chokidar.watch(pathMarker).on('change', () => {
  try {
    const newPath = fs.readFileSync(pathMarker, 'utf8').trim();
    if (newPath && fs.existsSync(newPath)) {
      console.log(`[SENTINEL] 🔄 Switching watch target to: ${newPath}`);
      
      // Update the global output directory for file reading
      // We don't have a file-watcher in Sentinel, it reacts to MAP_STATE changes,
      // but it needs to read the file content from the correct folder.
      
      // Clear caches for new project context
      scoredNodes.clear();
      embeddingCache.clear();
      
      // Re-trigger the initial pass logic on the new project state
      setTimeout(triggerInitialPass, 1000);
    }
  } catch (e) {
    console.error(`[SENTINEL] ✖ Path swap failed: ${e.message}`);
  }
});

console.log('[SENTINEL] Agent started successfully');
console.log('[SENTINEL] Drift score updates every 60 seconds');

setTimeout(triggerInitialPass, 2000);
