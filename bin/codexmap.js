#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { parseArgs, booleanFlag } = require('../lib/args');
const { runRuntime } = require('../lib/runtime');
const { runDoctor } = require('../lib/doctor');
const { listEngines, getEngine } = require('../engines');
const { sessionsRoot, listSessions } = require('../lib/session');
const { readUserConfig, setupUserConfig } = require('../lib/user-config');
const { atomicWriteFile } = require('../lib/atomic');
const {
  indexProject,
  loadProjectGraph,
  buildContext,
  formatContext,
  buildDiffContext,
  formatDiffReport,
  formatOnboardingGuide,
  graphPath,
  projectIndexPath,
  learnPath,
} = require('../lib/project-index');

const COMMANDS = new Set([
  'run',
  'watch',
  'doctor',
  'clean',
  'engines',
  'sessions',
  'setup',
  'init',
  'index',
  'ask',
  'context',
  'diff',
  'onboard',
  'help',
]);

function normalizeParsed(parsed) {
  if (!COMMANDS.has(parsed.command)) {
    return {
      command: 'run',
      flags: parsed.flags,
      positionals: [parsed.command, ...parsed.positionals],
    };
  }
  return parsed;
}

function printHelp() {
  console.log(`
CodexMap - local drift intelligence canvas for Codex CLI

Usage:
  codexmap <prompt...>
  codexmap run <prompt...> [--engine codex] [--watch <path>] [--auto-heal] [--open|--no-open] [--port <port>] [--ws-port <port>]
  codexmap watch <path> --prompt "<prompt>"
  codexmap index [path] [--max-files 500] [--include-output]
  codexmap ask <question...> [--path <project>]
  codexmap context <task...> [--path <project>] [--limit 12]
  codexmap diff [--path <project>]
  codexmap onboard [--path <project>]
  codexmap setup [--engine codex] [--no-cloud-scoring]
  codexmap doctor
  codexmap clean
  codexmap engines

Examples:
  pipx run codexmap "Build a REST API for todos with auth and PostgreSQL"
  npx codexmap "Build a REST API for todos with auth and PostgreSQL"
  codexmap "Build a REST API for todos with auth and PostgreSQL"
  codexmap doctor
  npx codexmap index
  npx codexmap ask where is authentication handled
  npx codexmap context add password reset flow
  npx codexmap diff
  npx codexmap "Map this project" --engine fake --no-open --no-cloud-scoring
  npx codexmap watch ./src --prompt "Existing app: detect context drift"
`);
}

async function printEngines() {
  for (const name of listEngines()) {
    const status = await getEngine(name).detect();
    console.log(`${name.padEnd(8)} ${status.available ? 'available' : 'missing'} ${status.binary || status.reason || ''}`);
  }
}

function clean(cwd) {
  const root = sessionsRoot(cwd);
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`Removed CodexMap sessions at ${root}`);
}

function joinPrompt(parts) {
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join(' ').trim();
}

function projectRootFrom(flags, fallback = process.cwd()) {
  return path.resolve(flags.path || flags.root || fallback);
}

function parseMaxFiles(value) {
  const parsed = Number(value || 500);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 500;
}

function printGraphMissingHelp(projectRoot) {
  console.error(`[CODEXMAP] No project graph found at ${graphPath(projectRoot)}`);
  console.error('[CODEXMAP] Run: npx codexmap index');
}

function runIndexCommand(flags, positionals) {
  const projectRoot = path.resolve(flags.path || flags.root || positionals[0] || process.cwd());
  const { graph, paths } = indexProject(projectRoot, {
    maxFiles: parseMaxFiles(flags.maxFiles),
    includeOutput: flags.includeOutput === true,
  });
  console.log('\nCodexMap project graph indexed\n');
  console.log(`Project: ${graph.project.name}`);
  console.log(`Files: ${graph.meta.fileCount}`);
  console.log(`Nodes: ${graph.nodes.length}`);
  console.log(`Edges: ${graph.edges.length}`);
  console.log(`Languages: ${(graph.project.languages || []).join(', ') || 'unknown'}`);
  console.log(`Frameworks: ${(graph.project.frameworks || []).join(', ') || 'none detected'}`);
  console.log('');
  console.log(`Graph: ${paths.graph}`);
  console.log(`Project index: ${paths.projectIndex}`);
  console.log(`Learning guide: ${paths.learn}`);
}

function withProjectGraph(flags, callback) {
  const projectRoot = projectRootFrom(flags);
  let graph;
  try {
    graph = loadProjectGraph(projectRoot);
  } catch (error) {
    printGraphMissingHelp(projectRoot);
    throw error;
  }
  return callback(projectRoot, graph);
}

function runAskCommand(flags, positionals) {
  const query = flags.query || joinPrompt(positionals);
  if (!query) throw new Error('codexmap ask requires a question.');
  withProjectGraph(flags, (_projectRoot, graph) => {
    const context = buildContext(graph, query, { limit: parseMaxFiles(flags.limit || 8) });
    if (context.nodes.length === 0) {
      console.log('No matching graph nodes found. Try broader terms or run `codexmap index` again.');
      return;
    }
    console.log(`\nCodexMap answer context for: ${query}\n`);
    context.results.slice(0, 8).forEach((result, index) => {
      const node = result.node;
      console.log(`${index + 1}. ${node.name} (${node.type})`);
      console.log(`   Path: ${node.filePath || node.id}`);
      console.log(`   Summary: ${node.summary || 'No summary available'}`);
    });
    if (context.edges.length > 0) {
      console.log('\nNearby relationships:');
      context.edges.slice(0, 8).forEach((edge) => console.log(`- ${edge.source} --[${edge.type}]--> ${edge.target}`));
    }
  });
}

function runContextCommand(flags, positionals) {
  const query = flags.query || joinPrompt(positionals);
  if (!query) throw new Error('codexmap context requires a task or topic.');
  withProjectGraph(flags, (_projectRoot, graph) => {
    console.log(formatContext(buildContext(graph, query, { limit: parseMaxFiles(flags.limit || 12) })));
  });
}

function runDiffCommand(flags) {
  withProjectGraph(flags, (projectRoot, graph) => {
    console.log(formatDiffReport(buildDiffContext(projectRoot, graph)));
  });
}

function runOnboardCommand(flags) {
  withProjectGraph(flags, (projectRoot, graph) => {
    const guide = formatOnboardingGuide(graph);
    atomicWriteFile(learnPath(projectRoot), guide, 'utf8');
    console.log(guide);
    console.log('');
    console.log(`Saved: ${learnPath(projectRoot)}`);
    console.log(`Project index: ${projectIndexPath(projectRoot)}`);
  });
}

async function runSetup(flags) {
  const openBrowser = booleanFlag(flags, 'open', 'noOpen', true);
  const cloudScoring = booleanFlag(flags, 'cloudScoring', 'noCloudScoring', true);
  const result = setupUserConfig(process.cwd(), {
    engine: flags.engine || 'codex',
    openBrowser,
    cloudScoring,
    autoHeal: flags.autoHeal === true,
    costCapUsd: flags.costCapUsd,
    httpPort: flags.port,
    wsPort: flags.wsPort,
  });

  console.log('\nCodexMap setup complete\n');
  console.log(`Config: ${result.path}`);
  console.log(`Engine: ${result.config.engine}`);
  console.log(`Cloud scoring: ${result.config.cloudScoring ? 'enabled' : 'disabled'}`);
  console.log(`Browser auto-open: ${result.config.openBrowser ? 'enabled' : 'disabled'}`);
  console.log(`Cost cap: $${Number(result.config.costCapUsd).toFixed(2)}`);
  console.log('\nNext commands:');
  console.log('  npx codexmap doctor');
  console.log('  npx codexmap Build a REST API for todos with auth and PostgreSQL');
}

async function main() {
  const parsed = normalizeParsed(parseArgs(process.argv.slice(2)));
  const { command, flags, positionals } = parsed;
  const userConfig = readUserConfig(process.cwd());

  if (flags.help || flags.h || command === 'help') {
    printHelp();
    return;
  }

  if (command === 'doctor') {
    const cloudScoring = booleanFlag(flags, 'cloudScoring', 'noCloudScoring', userConfig.cloudScoring);
    await runDoctor({
      cwd: process.cwd(),
      port: flags.port || userConfig.ports?.http,
      wsPort: flags.wsPort || userConfig.ports?.websocket,
      cloudScoring,
      json: flags.json === true,
    });
    return;
  }

  if (command === 'setup' || command === 'init') {
    await runSetup(flags);
    return;
  }

  if (command === 'engines') {
    await printEngines();
    return;
  }

  if (command === 'index') {
    runIndexCommand(flags, positionals);
    return;
  }

  if (command === 'ask') {
    runAskCommand(flags, positionals);
    return;
  }

  if (command === 'context') {
    runContextCommand(flags, positionals);
    return;
  }

  if (command === 'diff') {
    runDiffCommand(flags);
    return;
  }

  if (command === 'onboard') {
    runOnboardCommand(flags);
    return;
  }

  if (command === 'sessions') {
    const sessions = listSessions(process.cwd());
    if (sessions.length === 0) {
      console.log('No CodexMap sessions found.');
      return;
    }
    sessions.forEach((session) => {
      console.log(`${session.id}  ${session.updatedAt || '-'}  ${session.prompt.slice(0, 80)}`);
    });
    return;
  }

  if (command === 'clean') {
    clean(process.cwd());
    return;
  }

  let prompt = flags.prompt || joinPrompt(positionals);
  let watchPath = flags.watch || null;

  if (command === 'watch') {
    watchPath = positionals[0] || flags.watch;
    prompt = flags.prompt || joinPrompt(positionals.slice(1));
    if (!watchPath) throw new Error('codexmap watch requires a path.');
    if (!prompt) throw new Error('codexmap watch requires --prompt "<prompt>" or prompt words after the path.');
  }

  const openBrowser = booleanFlag(flags, 'open', 'noOpen', userConfig.openBrowser !== false);
  const cloudScoring = booleanFlag(flags, 'cloudScoring', 'noCloudScoring', userConfig.cloudScoring);

  const result = await runRuntime({
    command,
    cwd: process.cwd(),
    prompt,
    watchPath,
    engine: flags.engine || userConfig.engine || 'codex',
    autoHeal: flags.autoHeal === true || userConfig.autoHeal === true,
    openBrowser,
    cloudScoring,
    port: flags.port || userConfig.ports?.http,
    wsPort: flags.wsPort || userConfig.ports?.websocket,
    host: flags.host,
    resume: flags.resume,
    latest: flags.latest === true,
    costCapUsd: flags.costCapUsd || userConfig.costCapUsd,
  });

  if (result.code && result.code !== 0) process.exit(result.code);
}

main().catch((error) => {
  console.error(`[CODEXMAP] ${error.message}`);
  process.exit(1);
});
