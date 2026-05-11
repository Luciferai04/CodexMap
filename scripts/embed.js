const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('../config');
const { atomicWriteJson, readJsonSafe, ensureDir } = require('../lib/atomic');
const { canSpendEstimated, getCostCapUsd, getSharedDir, isCloudScoringEnabled, trackEmbeddingCost } = require('../lib/cost');

const client = config.openai.apiKey ? new OpenAI({ apiKey: config.openai.apiKey }) : null;

// In-memory cache: SHA256 hash → embedding vector
const embeddingCache = new Map();

// Persistent cache file
const SHARED_DIR = getSharedDir();
const CACHE_FILE = path.join(SHARED_DIR, 'embedding-cache.json');
ensureDir(SHARED_DIR);

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = readJsonSafe(CACHE_FILE, {});
      Object.entries(data).forEach(([k, v]) => embeddingCache.set(k, v));
      console.log(`[Embed] Loaded ${embeddingCache.size} cached embeddings`);
    }
  } catch(e) {
    console.error('[Embed] Failed to load cache:', e.message);
  }
}

function saveCache() {
  try {
    const data = {};
    embeddingCache.forEach((v, k) => { data[k] = v; });
    atomicWriteJson(CACHE_FILE, data);
  } catch(e) {
    console.error('[Embed] Failed to save cache:', e.message);
  }
}

function hashContent(text) {
  return crypto.createHash('sha256')
    .update(text.slice(0, 8000))
    .digest('hex')
    .slice(0, 16);
}

async function embed(text, useCache = true) {
  if (!text || text.trim().length === 0) return null;

  if (!isCloudScoringEnabled()) {
    console.warn('[Embed] Cloud scoring disabled; returning no embedding');
    return null;
  }

  // Demo Mode Fallback
  const isDemo = config.openai.apiKey === 'sk-demo-mode-12345';
  if (isDemo) {
    const vec = new Array(1536).fill(0);
    for (let i = 0; i < Math.min(text.length, 1536); i++) {
      vec[i % 1536] = text.charCodeAt(i) / 255;
    }
    return vec;
  }

  const truncated = text.slice(0, 8000);
  const hash = hashContent(truncated);

  // Return from cache if available
  if (useCache && embeddingCache.has(hash)) {
    return embeddingCache.get(hash);
  }

  if (!client) {
    console.warn('[Embed] OPENAI_API_KEY is missing; returning no embedding');
    return null;
  }

  const estimatedTokens = Math.ceil(truncated.length / 4);
  const spend = canSpendEstimated(estimatedTokens);
  if (!spend.allowed) {
    console.warn(`[Embed] ${spend.reason}; skipping embedding`);
    return null;
  }

  // Retry with exponential backoff
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await client.embeddings.create({
        model: config.openai.embeddingModel || 'text-embedding-3-small',
        input: truncated,
      });

      const vector = response.data[0].embedding;
      const tokens = response.usage.total_tokens;
      const cost = trackEmbeddingCost(tokens);

      console.log(`[Embed] tokens=${tokens} cost=$${cost.toFixed(5)} cap=$${getCostCapUsd().toFixed(2)}`);

      // Cache it
      embeddingCache.set(hash, vector);
      if (embeddingCache.size % 10 === 0) saveCache(); // save every 10 new

      return vector;

    } catch(err) {
      if (err.status === 429) {
        const wait = Math.pow(2, attempt) * 1500;
        console.warn(`[Embed] Rate limited, retrying in ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        console.error('[Embed] Error:', err.message);
        return null;
      }
    }
  }
  return null;
}

// Cosine similarity
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : Math.max(0, Math.min(1, dot / denom));
}

// Simple BM25 implementation — no dependencies needed
function bm25Score(query, document, k1 = 1.5, b = 0.75) {
  const queryTerms = tokenize(query);
  const docTerms   = tokenize(document);
  const docLen     = docTerms.length;

  if (docLen === 0 || queryTerms.length === 0) return 0;

  // Term frequency in document
  const tf = {};
  docTerms.forEach(t => tf[t] = (tf[t]||0) + 1);

  // Query term frequency (for IDF weighting)
  const queryTf = {};
  queryTerms.forEach(t => queryTf[t] = (queryTf[t]||0) + 1);

  // Average doc length (approximate for single-doc scoring)
  const avgDl = Math.max(docLen, 50);

  // Count matching terms for overlap ratio
  let matchedTerms = 0;
  let score = 0;

  queryTerms.forEach(term => {
    const termFreq = tf[term] || 0;
    if (termFreq === 0) return;

    matchedTerms++;

    // Proper IDF: log((N - n + 0.5) / (n + 0.5) + 1)
    // Since we score single doc, use query-term rarity as proxy
    const n = queryTf[term]; // fewer occurrences in query = rarer = higher IDF
    const idf = Math.log(1 + (queryTerms.length - n + 0.5) / (n + 0.5));

    // BM25 term score
    const num  = termFreq * (k1 + 1);
    const den  = termFreq + k1 * (1 - b + b * (docLen / avgDl));
    score     += idf * (num / den);
  });

  // Normalize by number of query terms and scale to 0-1
  const rawNorm = score / (queryTerms.length * 0.5);

  // Blend with simple overlap ratio for robustness
  const overlapRatio = matchedTerms / queryTerms.length;

  return Math.min(1, rawNorm * 0.6 + overlapRatio * 0.4);
}

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

loadCache();
module.exports = { embed, cosineSimilarity, hashContent, bm25Score, tokenize };
