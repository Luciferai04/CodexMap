const { spawn, spawnSync } = require('child_process');
const path = require('path');

function which(command) {
  const tool = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(tool, [command], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).find(Boolean) || null;
}

async function detect() {
  const binary = which(process.env.CODEXMAP_CODEX_PATH || 'codex');
  return {
    name: 'codex',
    available: !!binary,
    binary,
    reason: binary ? null : 'Codex CLI not found in PATH',
  };
}

async function health() {
  const status = await detect();
  const loginStatus = status.available
    ? spawnSync(status.binary, ['-c', 'model_reasoning_effort="low"', 'login', 'status'], { encoding: 'utf8' })
    : null;
  const hasKey = !!(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY);
  const hasCodexLogin = !!loginStatus && loginStatus.status === 0;
  return {
    ...status,
    authenticated: hasKey || hasCodexLogin,
    authHint: hasKey || hasCodexLogin
      ? null
      : 'Set OPENAI_API_KEY or sign in with Codex CLI',
  };
}

function buildEnv(env = {}) {
  const next = { ...process.env, ...env };
  if (!next.CODEX_API_KEY && next.OPENAI_API_KEY) next.CODEX_API_KEY = next.OPENAI_API_KEY;
  if (!next.OPENAI_API_KEY && next.CODEX_API_KEY) next.OPENAI_API_KEY = next.CODEX_API_KEY;
  return next;
}

function codexConfigArgs(model, effort) {
  return [
    '-c', `model="${model}"`,
    '-c', `model_reasoning_effort="${effort || 'low'}"`,
  ];
}

function start({ prompt, outputDir, env = {}, model }) {
  const binary = process.env.CODEXMAP_CODEX_PATH || 'codex';
  const resolvedOutputDir = path.resolve(outputDir);
  const selectedModel = model || process.env.CODEXMAP_CODEX_MODEL || process.env.OPENAI_MODEL || 'gpt-4o';
  const reasoningEffort = process.env.CODEXMAP_GENERATOR_REASONING_EFFORT || process.env.CODEXMAP_CODEX_REASONING_EFFORT || 'low';

  return spawn(binary, [
    ...codexConfigArgs(selectedModel, reasoningEffort),
    'exec',
    prompt,
    '--dangerously-bypass-approvals-and-sandbox',
    '--skip-git-repo-check',
    '--cd',
    resolvedOutputDir,
  ], {
    cwd: resolvedOutputDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildEnv(env),
  });
}

function reanchor({ prompt, filePath, cwd, env = {}, model }) {
  const binary = process.env.CODEXMAP_CODEX_PATH || 'codex';
  const selectedModel = model || process.env.CODEXMAP_CODEX_MODEL || process.env.OPENAI_MODEL || 'gpt-4o';
  const reasoningEffort = process.env.CODEXMAP_REANCHOR_REASONING_EFFORT || process.env.CODEXMAP_CODEX_REASONING_EFFORT || 'low';
  const workingDir = path.resolve(cwd || path.dirname(filePath));

  return spawn(binary, [
    ...codexConfigArgs(selectedModel, reasoningEffort),
    'exec',
    prompt,
    '--dangerously-bypass-approvals-and-sandbox',
    '--skip-git-repo-check',
    '--cd',
    workingDir,
  ], {
    cwd: workingDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildEnv(env),
  });
}

module.exports = {
  name: 'codex',
  detect,
  health,
  start,
  reanchor,
};
