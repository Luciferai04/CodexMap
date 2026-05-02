const fs = require('fs');

// Fix Cartographer
let carto = fs.readFileSync('agents/cartographer.js', 'utf8');
carto = carto.replace('if (!content) {\n    try {\n      content = fs.readFileSync(filePath, \'utf8\');\n    } catch (err) {\n    console.log(`[CARTOGRAPHER] ⚠ Cannot read file: ${filePath} (${err.message})`);\n    return { nodes: [], edges: [] };\n  }', 'if (!content) {\n    try {\n      content = fs.readFileSync(filePath, \'utf8\');\n    } catch (err) {\n      console.log(`[CARTOGRAPHER] ⚠ Cannot read file: ${filePath} (${err.message})`);\n      return { nodes: [], edges: [] };\n    }\n  }');
fs.writeFileSync('agents/cartographer.js', carto, 'utf8');

// Fix Broadcaster Health Port
let broad = fs.readFileSync('agents/broadcaster.js', 'utf8');
broad = broad.replace('healthServer.listen(4245', 'healthServer.listen(0');
fs.writeFileSync('agents/broadcaster.js', broad, 'utf8');

// Fix Orchestrator Health Port
let orch = fs.readFileSync('orchestrator.js', 'utf8');
orch = orch.replace('server.listen(config.ports.http', 'server.listen(0');
fs.writeFileSync('orchestrator.js', orch, 'utf8');
