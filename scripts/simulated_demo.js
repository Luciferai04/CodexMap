const fs = require('fs');
const path = require('path');

const sharedDir = path.join(__dirname, 'shared');
if (!fs.existsSync(sharedDir)) fs.mkdirSync(sharedDir, { recursive: true });

const logFile = path.join(sharedDir, 'agent-logs.json');
const mapFile = path.join(sharedDir, 'map-state.json');

const logs = [
  { time: '12:45:01', agent: 'ORCHESTRATOR', msg: '🚀 Initializing CodexMap v1.0.0...', cls: 'text-outline' },
  { time: '12:45:02', agent: 'GENERATOR', msg: 'Starting Codex with prompt: "build an auth database for a banking app"', cls: 'text-outline' },
  { time: '12:45:05', agent: 'CARTOGRAPHER', msg: '✔ Created file: models/User.js', cls: 'text-outline' },
  { time: '12:45:07', agent: 'SENTINEL', msg: 'Scoring models/User.js → 0.92 (High Alignment)', cls: 'text-tertiary' },
  { time: '12:45:10', agent: 'CARTOGRAPHER', msg: '✔ Created file: routes/auth.js', cls: 'text-outline' },
  { time: '12:45:12', agent: 'SENTINEL', msg: 'Scoring routes/auth.js → 0.85', cls: 'text-tertiary' },
  { time: '12:45:15', agent: 'GENERATOR', msg: 'Drift detected in routes/auth.js (missing password hashing)', cls: 'text-error' },
];

const nodes = [
  { id: 'models', label: 'models', type: 'dir' },
  { id: 'models/User.js', label: 'User.js', type: 'file', parent: 'models', grade: 'green', score: 0.92 },
  { id: 'routes', label: 'routes', type: 'dir' },
  { id: 'routes/auth.js', label: 'auth.js', type: 'file', parent: 'routes', grade: 'yellow', score: 0.85 },
  { id: 'database.js', label: 'database.js', type: 'file', grade: 'green', score: 0.95 }
];

const edges = [
  { id: 'e1', source: 'routes/auth.js', target: 'models/User.js' },
  { id: 'e2', source: 'models/User.js', target: 'database.js' }
];

fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
fs.writeFileSync(mapFile, JSON.stringify({ nodes, edges }, null, 2));

console.log('✅ Simulated demo state initialized in ./shared/');
console.log('Open ui/index.html to see the interactive map.');
