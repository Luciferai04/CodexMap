const { spawn, execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const promptArg = process.argv[2];
const watchArgIdx = process.argv.indexOf('--watch');
const watchDir = watchArgIdx !== -1 ? process.argv[watchArgIdx + 1] : null;

if (!promptArg) {
    console.error('❌ Error: Please provide a prompt.');
    console.log('Usage: node start.js "Your prompt here"');
    process.exit(1);
}

console.log('🚀 Launching CodexMap Zero-Config Workflow...');

// Step 1: Cleanup
try {
    console.log('[1/4] Performing session cleanup...');
    execSync('node scripts/clean_session.js', { stdio: 'inherit' });
} catch (e) {
    console.error('⚠️ Cleanup warning:', e.message);
}

// Step 2: Start Web Server (Serve UI)
console.log('[2/4] Starting UI Server on port 3333...');

// Kill anything on 3333 first to avoid stale server bugs
try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
        execSync('lsof -t -i:3333 | xargs kill -9 2>/dev/null || true');
    }
} catch (e) {}

const serveProc = spawn('node', ['serve.js'], { detached: true, stdio: 'ignore' });
serveProc.unref(); // Let it run in background

// Step 3: Open Browser (Mac/Windows/Linux)
setTimeout(() => {
    console.log('[3/4] Opening live dashboard...');
    const url = 'http://localhost:3333';
    const startCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${startCmd} ${url}`);
}, 1000);

// Step 4: Run Orchestrator
setTimeout(() => {
    console.log('[4/4] Powering up AI Agents & Generator...');
    console.log(`Prompt: "${promptArg}"`);
    if (watchDir) console.log(`Watch Directory: ${watchDir}\n`);
    
    const args = ['orchestrator.js', promptArg, '--enhanced-scoring'];
    if (watchDir) args.push('--watch', watchDir);

    const orchestrator = spawn('node', args, {
        stdio: 'inherit'
    });

    orchestrator.on('close', (code) => {
        console.log(`\n✅ Workflow complete (Exit code: ${code})`);
        console.log('Keep this terminal open to keep the UI server alive, or Ctrl+C to stop all.');
    });
}, 2000);

// Ensure serve process dies if this script is hard-stopped
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down CodexMap...');
    // We try to kill anything on 3333 just in case
    try {
        if (process.platform === 'darwin' || process.platform === 'linux') {
            execSync('lsof -t -i:3333 | xargs kill -9 2>/dev/null || true');
            execSync('lsof -t -i:4242 | xargs kill -9 2>/dev/null || true');
        }
    } catch (e) {}
    process.exit();
});
