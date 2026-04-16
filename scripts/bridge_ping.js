const fs = require('fs');
const path = require('path');

const MAP_STATE_PATH = path.join(__dirname, '..', 'shared', 'map-state.json');

function pingBridge() {
    console.log('--- CodexMap Bridge Ping ---');
    if (!fs.existsSync(MAP_STATE_PATH)) {
        console.error('❌ map-state.json not found. Run orchestrator first!');
        return;
    }

    const state = JSON.parse(fs.readFileSync(MAP_STATE_PATH, 'utf8'));
    
    // Add a temporary "Bridge_Test" node
    const testNode = {
        id: 'BRIDGE_TEST_NODE',
        label: '🚀 Bridge Active',
        type: 'file',
        grade: 'green',
        score: 0.99,
        summary: 'If you see this, your CLI-to-Browser bridge is working perfectly.'
    };

    // Remove old test node if exists
    state.nodes = state.nodes.filter(n => n.id !== testNode.id);
    state.nodes.push(testNode);

    fs.writeFileSync(MAP_STATE_PATH, JSON.stringify(state, null, 2));
    console.log('✅ Updated map-state.json with BRIDGE_TEST_NODE.');
    console.log('👉 Check your browser! You should see a green node labeled "🚀 Bridge Active".');
}

pingBridge();
