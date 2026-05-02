const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const SHARED_DIR = path.join(__dirname, '..', 'shared');

console.log('--- CodexMap Session Cleanup ---');

// Clear output files
if (fs.existsSync(OUTPUT_DIR)) {
    fs.readdirSync(OUTPUT_DIR).forEach(file => {
        if (file !== '.keep' && file !== '.gitkeep') {
            try {
                fs.rmSync(path.join(OUTPUT_DIR, file), { recursive: true, force: true });
            } catch (e) {
                console.warn(`⚠️ Could not delete ${file}: ${e.message}`);
            }
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
['session-drift-log.json', 'grade-queue.json', 'generation-done.txt', 'agent-logs.json'].forEach(file => {
    const p = path.join(SHARED_DIR, file);
    if (fs.existsSync(p)) fs.unlinkSync(p);
});
console.log('✅ Cleared session logs and markers');

// Clean orphaned .tmp files in shared/
if (fs.existsSync(SHARED_DIR)) {
    const tmpFiles = fs.readdirSync(SHARED_DIR).filter(f => f.includes('.tmp'));
    tmpFiles.forEach(f => {
        try { fs.unlinkSync(path.join(SHARED_DIR, f)); } catch (e) {}
    });
    if (tmpFiles.length > 0) console.log(`✅ Cleaned ${tmpFiles.length} orphaned .tmp file(s)`);
}

console.log('\n✨ System ready for a clean demo run!');
