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
    websocket: parseInt(process.env.CODEXMAP_PORT || '4242'),
    http: parseInt(process.env.CODEXMAP_HTTP_PORT || '3000'),
  },
  paths: {
    output: process.env.OUTPUT_DIR || './output',
    shared: process.env.SHARED_DIR || './shared',
  },
  scoring: {
    weights: {
      S1: parseFloat(process.env.WEIGHT_S1 || '0.2'),
      S2: parseFloat(process.env.WEIGHT_S2 || '0.4'),
      A:  parseFloat(process.env.WEIGHT_A  || '0.2'),
      T:  parseFloat(process.env.WEIGHT_T  || '0.2'),
      D:  parseFloat(process.env.WEIGHT_D  || '0.3'),
    },
    thresholds: {
      green:  parseFloat(process.env.THRESHOLD_GREEN  || '0.75'),
      yellow: parseFloat(process.env.THRESHOLD_YELLOW || '0.50'),
      autoHeal: parseFloat(process.env.AUTO_HEAL_THRESHOLD || '0.40'),
    },
  },
  collapse: {
    redDensityThreshold: parseFloat(process.env.COLLAPSE_RED_DENSITY || '0.40'),
    edgeGrowthMultiplier: parseFloat(process.env.COLLAPSE_EDGE_MULT  || '3.0'),
    ccBaselineMultiplier: parseFloat(process.env.COLLAPSE_CC_MULT    || '2.0'),
  },
};

// Validate on startup
function validate() {
  const errors = [];
  if (!config.openai.apiKey) 
    errors.push('OPENAI_API_KEY is required. Add it to .env');
  if (config.openai.apiKey && !config.openai.apiKey.startsWith('sk-'))
    errors.push('OPENAI_API_KEY looks invalid (should start with sk-)');
  const wSum = Object.entries(config.scoring.weights)
    .reduce((s,[,v]) => s+v, 0);
  if (Math.abs(wSum - 1.0) > 0.01)
    errors.push(`Score weights must sum to 1.0 (got ${wSum.toFixed(2)})`);
  return errors;
}

module.exports = { config, validate };
