/**
 * agents/generator.js — Agent A1: Codex CLI wrapper
 * Built by @Somu.ai for the OpenAI Codex Hackathon 2025
 *
 * Reads the developer prompt from shared/prompt.txt and spawns
 * codex --approval-mode auto-edit with the prompt. Pipes stdout/stderr
 * through for logging. On close, writes a marker file for Broadcaster.
 *
 * CRITICAL rules from SKILL.md:
 * - Never parse Codex stdout — all downstream intelligence uses
 *   the filesystem watcher (Cartographer) only.
 * - Always run Codex with --approval-mode auto-edit.
 */

const fs = require('fs');
const path = require('path');
const { getEngine } = require('../engines');
const { ensureDir, atomicWriteFile } = require('../lib/atomic');

// ─── Paths ──────────────────────────────────────────────────────────────────
const SHARED_DIR = path.resolve(process.env.CODEXMAP_SHARED_DIR || path.join(__dirname, '..', 'shared'));
const PROMPT_PATH = path.join(SHARED_DIR, 'prompt.txt');
const GENERATION_DONE_PATH = path.join(SHARED_DIR, 'generation-done.txt');
const OUTPUT_DIR = path.resolve(process.env.CODEXMAP_OUTPUT_DIR || path.join(__dirname, '..', 'output'));

// ─── Ensure output directory exists ─────────────────────────────────────────
ensureDir(SHARED_DIR);
if (!fs.existsSync(OUTPUT_DIR)) {
  ensureDir(OUTPUT_DIR);
  console.log('[GENERATOR] Created output/ directory');
}

// ─── Read prompt ────────────────────────────────────────────────────────────
let prompt;
try {
  prompt = fs.readFileSync(PROMPT_PATH, 'utf8').trim();
} catch (err) {
  console.error(`[GENERATOR] ✖ Failed to read prompt: ${err.message}`);
  process.exit(1);
}

if (!prompt) {
  console.error('[GENERATOR] ✖ Prompt is empty');
  process.exit(1);
}

// Hardened instruction to bypass the codex CLI exec bug
prompt += "\n\nCRITICAL: You MUST use the file update/edit tools to create and modify files. DO NOT use the exec tool or shell commands (like mkdir or touch), as they will fail due to a known sandbox bug.";

console.log(`[GENERATOR] Starting Codex with prompt: "${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}"`);

// ─── Remove previous generation-done marker ─────────────────────────────────
try {
  if (fs.existsSync(GENERATION_DONE_PATH)) {
    fs.unlinkSync(GENERATION_DONE_PATH);
  }
} catch (err) {
  // Ignore
}

const isDemoMode = process.env.OPENAI_API_KEY === 'sk-demo-mode-12345';
const engineName = process.env.CODEXMAP_ENGINE || (isDemoMode ? 'fake' : 'codex');

if (isDemoMode) {
  console.log('[GENERATOR] 🧪 Simulation Mode Active: Generating Banking App Scaffold');
  setTimeout(() => {
    simulateBankingApp();
  }, 2000);
} else {
  const engine = getEngine(engineName);
  const codex = engine.start({
    prompt,
    outputDir: OUTPUT_DIR,
    env: process.env,
    approvalMode: 'auto-edit',
  });

  // Pipe stdout through for logging — do NOT parse it
  codex.stdout.on('data', (chunk) => {
    process.stdout.write(`[GENERATOR] ${chunk}`);
  });

  // Pipe stderr through for logging
  codex.stderr.on('data', (chunk) => {
    process.stderr.write(`[GENERATOR] ${chunk}`);
  });

  // ─── On Codex process close ─────────────────────────────────────────────────
  codex.on('close', (code) => {
    console.log(`[GENERATOR] ${engineName} process exited with code ${code}`);
    finishGeneration();
  });

  codex.on('error', (err) => {
    console.error(`[GENERATOR] ✖ Failed to spawn ${engineName}: ${err.message}`);
    finishGeneration(`error: ${err.message}`);
  });
}

function simulateBankingApp() {
  const files = {
    'server.js': 'const express = require("express");\nconst app = express();\napp.listen(3000);',
    'auth/login.js': 'module.exports = function login(u, p) {\n  if (u === "admin") return true;\n  return false;\n};',
    'payments/stripe.js': 'const stripe = require("stripe")("sk_test_...");\nexport async function pay(amt) {\n  return await stripe.charges.create({ amount: amt });\n}',
    'accounts/manager.js': 'class AccountManager {\n  getBalance(id) { return 1000.00; }\n}',
    'test_red.js': '// Deliberate architectural drift\nprocess.env.STRIPE_KEY = "HARDCODED_KEY_BAD";',
    'test_green.js': '// Well-structured domain logic\nexport function validateAccount(id) {\n  return id.startsWith("ACC-");\n}'
  };

  Object.entries(files).forEach(([fPath, content]) => {
    const fullPath = path.join(OUTPUT_DIR, fPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`[GENERATOR] 📝 Simulated file: ${fPath}`);
  });

  finishGeneration();
}

function finishGeneration(errorMsg) {
  try {
    const content = errorMsg || new Date().toISOString();
    atomicWriteFile(GENERATION_DONE_PATH, content, 'utf8');
    console.log('[GENERATOR] ✔ Written generation-done.txt marker');
  } catch (err) {
    console.error(`[GENERATOR] ✖ Failed to write generation-done marker: ${err.message}`);
  }
}

console.log('[GENERATOR] Agent started successfully');

// Signal readiness to Orchestrator
if (process.send) {
  process.send({ type: 'ready' });
}
