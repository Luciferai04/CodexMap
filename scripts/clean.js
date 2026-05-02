const fs = require('fs');
const path = require('path');

const toClean = [
  './output',
  './shared/map-state.json',
  './shared/session-drift-log.json', 
  './shared/prompt.txt',
  './shared/pageindex-tree.json',
  './shared/cross-encoder-scores.json',
  './shared/api-cost.json',
  './shared/error.log',
  './shared/heal-queue.json'
];

toClean.forEach(p => {
  try {
    if (fs.statSync(p).isDirectory()) {
      fs.readdirSync(p)
        .filter(f => f !== '.gitkeep')
        .forEach(f => fs.unlinkSync(path.join(p, f)));
      console.log(`🧹 Cleaned ${p}/`);
    } else {
      fs.unlinkSync(p);
      console.log(`🧹 Removed ${p}`);
    }
  } catch(e) {}
});

// Re-init shared state
fs.writeFileSync('./shared/map-state.json', 
  JSON.stringify({ nodes:[], edges:[], meta:{} }, null, 2));
fs.writeFileSync('./shared/session-drift-log.json', '[]');
console.log('✅ Workspace cleaned');
