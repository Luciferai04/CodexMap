// Zero-dependency .env loader
try {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    env.split('\n').forEach(line => {
      const [key, ...value] = line.split('=');
      if (key && value) process.env[key.trim()] = value.join('=').trim();
    });
  }
} catch (e) {}

const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
  },
  ports: {
    websocket: parseInt(process.env.CODEXMAP_WS_PORT || process.env.CODEXMAP_PORT || '4242', 10),
    http: parseInt(process.env.CODEXMAP_HTTP_PORT || '3333', 10),
  },
  paths: {
    output: process.env.CODEXMAP_OUTPUT_DIR || process.env.OUTPUT_DIR || './output',
    shared: process.env.CODEXMAP_SHARED_DIR || process.env.SHARED_DIR || './shared',
  },
  runtime: {
    engine: process.env.CODEXMAP_ENGINE || 'codex',
    cloudScoring: !['0', 'false', 'no', 'off'].includes(String(process.env.CODEXMAP_CLOUD_SCORING || 'true').toLowerCase()),
    host: process.env.CODEXMAP_HOST || '127.0.0.1',
    sessionId: process.env.CODEXMAP_SESSION_ID || null,
    sessionDir: process.env.CODEXMAP_SESSION_DIR || null,
  },
  scoring: {
    weights: {
      S1: parseFloat(process.env.WEIGHT_S1 || '0.30'), // Cosine (Dense)
      S2: parseFloat(process.env.WEIGHT_S2 || '0.20'), // BM25 (Sparse)
      A:  parseFloat(process.env.WEIGHT_A  || '0.20'), // Arch Consistency
      T:  parseFloat(process.env.WEIGHT_T  || '0.10'), // Type Safety
      D:  parseFloat(process.env.WEIGHT_D  || '0.20'), // Drift-Penalized PageIndex
    },
    thresholds: {
      green:  parseFloat(process.env.THRESHOLD_GREEN  || '0.75'),
      yellow: parseFloat(process.env.THRESHOLD_YELLOW || '0.40'),
      autoHeal: parseFloat(process.env.AUTO_HEAL_THRESHOLD || '0.40'),
    },
  },
  collapse: {
    redDensityThreshold: parseFloat(process.env.COLLAPSE_RED_DENSITY || '0.65'),
    edgeGrowthMultiplier: parseFloat(process.env.COLLAPSE_EDGE_MULT  || '3.0'),
    ccBaselineMultiplier: parseFloat(process.env.COLLAPSE_CC_MULT    || '2.0'),
  },
};

// Validate on startup
function validate() {
  const errors = [];
  const requiresOpenAIKey = config.runtime.cloudScoring && config.runtime.engine !== 'fake';
  if (requiresOpenAIKey && !config.openai.apiKey)
    errors.push('OPENAI_API_KEY is required. Add it to .env');
  if (config.openai.apiKey && !config.openai.apiKey.startsWith('sk-') && config.openai.apiKey !== 'sk-demo-mode-12345')
    errors.push('OPENAI_API_KEY looks invalid (should start with sk-)');
  const wSum = Object.entries(config.scoring.weights)
    .reduce((s,[,v]) => s+v, 0);
  if (Math.abs(wSum - 1.0) > 0.01)
    errors.push(`Score weights must sum to 1.0 (got ${wSum.toFixed(2)})`);
  return errors;
}

module.exports = { config, validate };
