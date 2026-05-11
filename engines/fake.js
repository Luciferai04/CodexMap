const { spawn } = require('child_process');

async function detect() {
  return {
    name: 'fake',
    available: true,
    binary: process.execPath,
    reason: null,
  };
}

async function health() {
  return {
    name: 'fake',
    available: true,
    authenticated: true,
  };
}

function start({ outputDir }) {
  const script = `
    const fs = require('fs');
    const path = require('path');
    const out = process.env.CODEXMAP_OUTPUT_DIR || ${JSON.stringify(outputDir)};
    fs.mkdirSync(path.join(out, 'src'), { recursive: true });
    fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ scripts: { start: 'node src/server.js' }, dependencies: { express: '^4.18.0' } }, null, 2));
    fs.writeFileSync(path.join(out, 'src/server.js'), 'const express = require("express");\\nconst app = express();\\napp.get("/todos", (req, res) => res.json([]));\\napp.listen(3000);\\n');
    fs.writeFileSync(path.join(out, 'README.md'), '# Fake CodexMap fixture\\n');
    console.log('[FAKE_ENGINE] wrote fixture files');
  `;
  return spawn(process.execPath, ['-e', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CODEXMAP_OUTPUT_DIR: outputDir },
  });
}

function reanchor({ filePath }) {
  const script = `
    const fs = require('fs');
    const file = process.env.CODEXMAP_REANCHOR_FILE;
    if (file && fs.existsSync(file)) fs.appendFileSync(file, '\\n// Re-anchored by fake engine\\n');
    console.log('[FAKE_ENGINE] reanchored ' + file);
  `;
  return spawn(process.execPath, ['-e', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CODEXMAP_REANCHOR_FILE: filePath },
  });
}

module.exports = {
  name: 'fake',
  detect,
  health,
  start,
  reanchor,
};
