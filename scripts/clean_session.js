const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const SHARED_DIR = path.join(__dirname, '..', 'shared');

console.log('--- CodexMap Session Cleanup ---');

// Clear output files
if (fs.existsSync(OUTPUT_DIR)) {
    fs.readdirSync(OUTPUT_DIR).forEach(file => {
        if (file !== '.keep' && file !== '.gitkeep') {
            fs.unlinkSync(path.join(OUTPUT_DIR, file));
        }
    });
    console.log('✅ Cleared /output folder');
}

// Reset map state
const mapStatePath = path.join(SHARED_DIR, 'map-state.json');
const initialState = { nodes: [], edges: [] };
fs.writeFileSync(mapStatePath, JSON.stringify(initialState, null, 2));
console.log('✅ Reset shared/map-state.json');

// Clear session logs
['session-drift-log.json', 'grade-queue.json', 'generation-done.txt'].forEach(file => {
    const p = path.join(SHARED_DIR, file);
    if (fs.existsSync(p)) fs.unlinkSync(p);
});
console.log('✅ Cleared session logs and markers');

console.log('\n✨ System ready for a clean demo run!');
