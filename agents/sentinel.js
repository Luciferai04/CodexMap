/**
 * agents/sentinel.js — Scoring & Health Monitoring Agent
 * Uses config.js weights (sum=1.0) and thresholds for consistent grading.
 * D acts as a penalty multiplier on the base score, not a weighted subtraction.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { bm25Score } = require('../scripts/embed');
const { config } = require('../config');
const { atomicWriteJson, readJsonSafe, ensureDir } = require('../lib/atomic');

const SHARED_DIR = path.resolve(process.env.CODEXMAP_SHARED_DIR || path.join(__dirname, '../shared'));
const MAP_STATE_PATH = path.join(SHARED_DIR, 'map-state.json');
const DRIFT_LOG_PATH = path.join(SHARED_DIR, 'session-drift-log.json');
const PROMPT_PATH    = path.join(SHARED_DIR, 'prompt.txt');
ensureDir(SHARED_DIR);

const WEIGHTS    = config.scoring.weights;
const THRESHOLDS = config.scoring.thresholds;

async function gradeNode(nodeId, nodeCode, promptText, pageIndexData) {
  if (!nodeCode || nodeCode.length < 5) return { grade: 'pending', score: 0, S1: 0, S2: 0, A: 0, T: 0, D: 0, S_final: 0 };

  const S1 = computeS1(nodeCode, promptText);
  const S2 = computeS2(nodeCode, promptText, pageIndexData);
  const A  = computeArchScore(nodeCode, promptText);
  const T  = computeTechScore(nodeCode);
  const D  = computeDriftPenalty(nodeCode, nodeId);

  // Base score: weighted sum of positive components
  const S_base = WEIGHTS.S1 * S1 +
                 WEIGHTS.S2 * S2 +
                 WEIGHTS.A  * A  +
                 WEIGHTS.T  * T;

  // D as penalty multiplier: S_base * (1 - D*wd)
  const S_final = S_base * (1 - D * WEIGHTS.D);

  const clamped = Math.max(0, Math.min(1, S_final));
  let grade = 'green';
  if (clamped < THRESHOLDS.yellow) grade = 'red';
  else if (clamped < THRESHOLDS.green) grade = 'yellow';

  const result = {
    grade,
    S_final: clamped,
    S1, S2, A, T, D,
    summary: await generateMiniSummary(nodeCode, nodeId)
  };
  console.log(`[SENTINEL] Graded ${nodeId}: ${grade} (${clamped.toFixed(2)})`);
  return result;
}

function computeS1(code, prompt) {
  const p = prompt.toLowerCase();
  const c = code.toLowerCase();

  // Extract meaningful keywords from prompt (broader set)
  const allKeywords = p.match(/\b[a-z]{4,}\b/g) || [];
  const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'have', 'been', 'will', 'would', 'should', 'could', 'build', 'make', 'create', 'using', 'about', 'your', 'their', 'which', 'there', 'these', 'those', 'function', 'functionality']);
  const keywords = [...new Set(allKeywords.filter(k => !stopWords.has(k)))];

  if (keywords.length === 0) return 0.5;

  // Check how many prompt keywords appear in code
  const matches = keywords.filter(k => c.includes(k));
  const matchRatio = matches.length / keywords.length;

  // Base score + match bonus, clamped 0-1
  return Math.min(1, 0.3 + matchRatio * 0.7);
}

function computeS2(code, prompt, pageIndex) {
  // 1. Try BM25 against prompt
  const score = bm25Score(code, prompt);

  // 2. If pageIndex available, boost significantly
  if (pageIndex && pageIndex.relevance) {
    return (score * 0.4) + (pageIndex.relevance * 0.6);
  }

  return score;
}

function computeArchScore(code, prompt) {
  const p = prompt.toLowerCase();
  const c = code.toLowerCase();
  const domains = ['payment', 'auth', 'login', 'api', 'db', 'ui', 'logic', 'server', 'client', 'data', 'model', 'route', 'handler', 'middleware', 'database', 'user', 'account', 'session', 'token', 'todo', 'task', 'app', 'config', 'error', 'test'];
  const activeDomains = domains.filter(d => p.includes(d));
  if (activeDomains.length === 0) return 0.7;
  const matches = activeDomains.filter(d => c.includes(d));
  // Higher base + domain match bonus
  return 0.5 + (matches.length / activeDomains.length) * 0.5;
}

function computeTechScore(code) {
  let score = 0.85;
  if (code.includes('console.log')) score -= 0.05;
  if (code.includes('TODO')) score -= 0.05;
  if (code.includes('FIXME')) score -= 0.05;
  // Bonus for good practices
  if (code.includes('try') && code.includes('catch')) score += 0.05;
  if (code.includes('export') || code.includes('module.exports')) score += 0.05;
  return Math.max(0.3, Math.min(1, score));
}

function computeDriftPenalty(code, nodeId) {
  let penalty = 0;

  // 1. Hardcoded secrets (highest priority)
  if (/(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]/i.test(code)) {
    penalty += 0.3;
  }

  // 2. Off-scope imports (only penalize clear mismatches)
  if (!nodeId.includes('payment') && !nodeId.includes('stripe') && !nodeId.includes('checkout')) {
    if (code.includes('stripe') || code.includes('paypal')) {
      penalty += 0.1;
    }
  }

  // 3. node_modules only
  if (nodeId.includes('node_modules')) {
    penalty += 0.1;
  }

  // 4. Complexity vs Lines (only flag extreme cases)
  const lineCount = code.split('\n').length;
  const complexity = (code.match(/\b(if|for|while|switch|catch)\b/g) || []).length;
  if (lineCount > 20 && complexity > lineCount * 0.5) {
    penalty += 0.1;
  }

  return Math.min(0.5, penalty);
}

async function generateMiniSummary(code, nodeId) {
  // Simple heuristic for now
  const lines = code.split('\n');
  const firstComment = lines.find(l => l.trim().startsWith('//') || l.trim().startsWith('/*'));
  return firstComment ? firstComment.replace(/\/\/|\/\*|\*\//g, '').trim() : `Module: ${nodeId.split('/').pop()}`;
}

// Background Monitor
let lastGrades = {};
let lastAvgDrift = null;
let isHealing = false;

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function scoringFingerprint(node, promptText) {
  const contentHash = node.contentHash || hashText(node.code || '');
  return `${contentHash}:${hashText(promptText)}:${config.scoring.version || 'v1'}`;
}

function hasCurrentScore(node, promptText) {
  return (
    node.grade &&
    node.grade !== 'pending' &&
    node.score !== null &&
    node.score !== undefined &&
    node.scoringFingerprint === scoringFingerprint(node, promptText)
  );
}

// Handle reanchor messages from orchestrator
process.on('message', async (msg) => {
  if (msg.type !== 'reanchor') return;
  
  const { nodeId } = msg;
  console.log(`[SENTINEL] Re-anchoring: ${nodeId}`);
  
  const state = readJsonSafe(MAP_STATE_PATH, { nodes: [], edges: [] });
  const node  = state.nodes.find(n => n.id === nodeId);
  if (!node) {
    console.warn('[SENTINEL] Node not found for reanchor:', nodeId);
    return;
  }
  
  // Broadcast "healing in progress"
  process.send?.({
    type:    'heal_progress',
    payload: { nodeId, status: 'healing', label: node.label || nodeId.split('/').pop() },
  });
  
  // Re-read the file (generator may have rewritten it) — wait up to 15s
  let freshCode = node.code;
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const filePath = node.path || node.id;
      if (fs.existsSync(filePath)) {
        const newCode = fs.readFileSync(filePath, 'utf8');
        if (newCode !== node.code && newCode.trim().length > 0) {
          freshCode = newCode;
          console.log(`[SENTINEL] File rewritten, new code: ${freshCode.length} chars`);
          break;
        }
      }
    } catch(e) {}
  }
  
  // Re-score with fresh code
  const promptText = fs.existsSync(PROMPT_PATH) ? fs.readFileSync(PROMPT_PATH, 'utf8') : '';
  const result = await gradeNode(nodeId, freshCode, promptText, node.pageIndex);
  
  console.log(`[SENTINEL] Reanchor complete: ${result.grade} (${result.S_final?.toFixed(2)})`);
  
  // Broadcast heal_complete
  process.send?.({
    type:    'heal_complete',
    payload: {
      nodeId,
      grade:   result.grade,
      score:   result.S_final,
      S_final: result.S_final,
      S1:      result.S1,
      S2:      result.S2,
      A:       result.A,
      T:       result.T,
      D:       result.D,
      summary: result.summary,
      label:   node.label || nodeId.split('/').pop(),
      improved: result.S_final > (node.S_final || node.score || 0),
    }
  });
});

async function runSentinel() {
  console.log('[SENTINEL] Agent loop starting (3s interval)');
  setInterval(async () => {
    try {
      const state = readJsonSafe(MAP_STATE_PATH, { nodes: [], edges: [] });
      const promptText = fs.existsSync(PROMPT_PATH) ? fs.readFileSync(PROMPT_PATH, 'utf8') : '';

      let totalScore = 0;
      let count = 0;

      let changed = false;
      for (let node of state.nodes) {
        if (node.type === 'directory') continue;

        if (hasCurrentScore(node, promptText)) {
          totalScore += Number(node.score) || 0;
          count++;
          continue;
        }

        const fingerprint = scoringFingerprint(node, promptText);
        const result = await gradeNode(node.id, node.code, promptText, node.pageIndex);

        if (
          node.grade !== result.grade ||
          node.score !== result.S_final ||
          node.scoringFingerprint !== fingerprint
        ) {
          node.grade = result.grade;
          node.score = result.S_final;
          node.scoringMetadata = result;
          node.scoringFingerprint = fingerprint;
          node.lastScoredAt = new Date().toISOString();
          changed = true;

          process.send?.({
            type: 'node_grade',
            payload: { id: node.id, ...result }
          });
        }

        totalScore += result.S_final;
        count++;
      }

      if (changed) {
        atomicWriteJson(MAP_STATE_PATH, state);
      }

      if (count > 0) {
        const avgDrift = totalScore / count;
        if (avgDrift !== lastAvgDrift) {
          lastAvgDrift = avgDrift;
          const driftLog = readJsonSafe(DRIFT_LOG_PATH, []);
          driftLog.push({
            score: Math.round(avgDrift * 100),
            timestamp: new Date().toISOString()
          });
          atomicWriteJson(DRIFT_LOG_PATH, driftLog);
        }
      }
    } catch(e) {
      console.error('[SENTINEL] Error:', e.message);
    }
  }, 3000);

  // Notify orchestrator that we are ready
  if (process.send) {
    process.send({ type: 'ready' });
  }
}

if (require.main === module) {
  runSentinel();
}

module.exports = { gradeNode, computeS2, computeDriftPenalty };
