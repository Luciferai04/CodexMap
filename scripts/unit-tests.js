#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { parseArgs, booleanFlag } = require('../lib/args');
const { parseBool, parsePort, resolveRuntimeConfig } = require('../lib/config-resolver');
const { atomicWriteJson, readJsonSafe, safeInside } = require('../lib/atomic');
const { createSession, listSessions } = require('../lib/session');
const { getEngine, listEngines } = require('../engines');
const { validateEngineAdapter } = require('../engines/contract');
const {
  indexProject,
  loadProjectGraph,
  searchGraph,
  buildContext,
  buildDiffContext,
  graphPath,
  projectIndexPath,
  learnPath,
} = require('../lib/project-index');

async function main() {
  {
    const parsed = parseArgs(['run', 'hello world', '--engine', 'fake', '--no-open', '--ws-port=4545']);
    assert.equal(parsed.command, 'run');
    assert.equal(parsed.positionals[0], 'hello world');
    assert.equal(parsed.flags.engine, 'fake');
    assert.equal(parsed.flags.noOpen, true);
    assert.equal(parsed.flags.wsPort, '4545');
    assert.equal(booleanFlag(parsed.flags, 'open', 'noOpen', true), false);
  }

  {
    assert.equal(parseBool('false', true), false);
    assert.equal(parseBool('1', false), true);
    assert.equal(parsePort('3333', 1), 3333);
    assert.equal(parsePort('bad', 1), 1);
  }

  {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const occupiedPort = server.address().port;
    const resolved = await resolveRuntimeConfig({
      cwd: process.cwd(),
      httpPort: occupiedPort,
      wsPort: 42420,
      engine: 'fake',
      cloudScoring: false,
    });
    assert.notEqual(resolved.httpPort, occupiedPort);
    assert.equal(resolved.httpPortFallback, true);
    await new Promise((resolve) => server.close(resolve));
  }

  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmap-unit-'));
    const file = path.join(tmp, 'state.json');
    atomicWriteJson(file, { ok: true });
    assert.deepEqual(readJsonSafe(file, {}), { ok: true });
    assert.equal(safeInside(tmp, path.join(tmp, 'nested', 'file.txt')), true);
    assert.equal(safeInside(tmp, path.join(tmp, '..', 'escape.txt')), false);
  }

  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmap-session-'));
    const session = createSession({
      cwd: tmp,
      prompt: 'unit prompt',
      engine: 'fake',
      cloudScoring: false,
      outputDir: path.join(tmp, 'watched'),
    });
    assert.ok(fs.existsSync(path.join(session.sharedDir, 'map-state.json')));
    const state = readJsonSafe(path.join(session.sharedDir, 'map-state.json'), null);
    assert.equal(state.version, 1);
    assert.equal(state.meta.engine, 'fake');
    assert.equal(listSessions(tmp).length, 1);
  }

  {
    assert.ok(listEngines().includes('codex'));
    assert.ok(listEngines().includes('fake'));
    const fake = await getEngine('fake').detect();
    assert.equal(fake.available, true);
    assert.throws(() => getEngine('missing'), /Unknown engine/);
    assert.throws(() => validateEngineAdapter('broken', { detect() {} }), /missing health/);
  }

  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmap-index-'));
    fs.mkdirSync(path.join(tmp, 'src', 'routes'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'sample-api',
      dependencies: { express: '^5.0.0', pg: '^8.0.0' },
    }));
    fs.writeFileSync(path.join(tmp, 'README.md'), '# Sample API\n\nA tiny auth API.');
    fs.writeFileSync(path.join(tmp, 'src', 'db.js'), 'module.exports.query = async function query(sql) { return sql; };\n');
    fs.writeFileSync(path.join(tmp, 'src', 'routes', 'auth.js'), "const db = require('../db');\nfunction login(req, res) { return db.query('select 1'); }\nmodule.exports = { login };\n");

    const { graph, paths } = indexProject(tmp, { maxFiles: 20 });
    assert.equal(paths.graph, graphPath(tmp));
    assert.ok(fs.existsSync(projectIndexPath(tmp)));
    assert.ok(fs.existsSync(learnPath(tmp)));
    assert.ok(graph.nodes.some((node) => node.filePath === 'src/routes/auth.js'));
    assert.ok(graph.edges.some((edge) => edge.type === 'imports'));
    assert.ok(graph.project.frameworks.includes('Express'));

    const loaded = loadProjectGraph(tmp);
    const results = searchGraph(loaded, 'auth login', { limit: 3 });
    assert.ok(results.length > 0);
    const context = buildContext(loaded, 'database auth', { limit: 4 });
    assert.ok(context.nodes.length > 0);
    const diff = buildDiffContext(tmp, loaded, ['src/routes/auth.js']);
    assert.ok(diff.changedNodes.length > 0);
  }

  console.log('[unit-tests] all assertions passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
