const fs = require('fs');
let code = fs.readFileSync('agents/broadcaster.js', 'utf8');

const costWatcher = `
const API_COST_PATH = path.join(SHARED_DIR, 'api-cost.json');
chokidar.watch(API_COST_PATH, { persistent: true, ignoreInitial: false }).on('all', () => {
  try {
    const costData = readJsonSafe(API_COST_PATH, { total_tokens: 0, total_cost_usd: 0 });
    broadcast({ type: 'cost_update', payload: costData });
  } catch(e) {}
});
`;

if (!code.includes("API_COST_PATH")) {
  code = code.replace(
    "// ─── Watch heal-complete.json",
    costWatcher + "\n// ─── Watch heal-complete.json"
  );
  fs.writeFileSync('agents/broadcaster.js', code, 'utf8');
}
