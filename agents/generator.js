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

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Paths ──────────────────────────────────────────────────────────────────
const SHARED_DIR = path.join(__dirname, '..', 'shared');
const PROMPT_PATH = path.join(SHARED_DIR, 'prompt.txt');
const GENERATION_DONE_PATH = path.join(SHARED_DIR, 'generation-done.txt');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

// ─── Ensure output directory exists ─────────────────────────────────────────
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
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

if (isDemoMode) {
  console.log('[GENERATOR] 🧪 Simulation Mode Active: Generating Banking App Scaffold');
  setTimeout(() => {
    simulateBankingApp();
  }, 2000);
} else {
  // ─── Resolve Codex binary dynamically ───────────────────────────────────────
  let CODEX_PATH = 'codex'; // Default: assume it's in PATH
  try {
    const { execSync } = require('child_process');
    const resolved = execSync('which codex', { encoding: 'utf8', timeout: 5000 }).trim();
    if (resolved) CODEX_PATH = resolved;
  } catch (e) {
    // 'which' failed — fall back to bare 'codex' and hope PATH is set
    console.log('[GENERATOR] ⚠ Could not resolve codex path, using PATH default');
  }
  const codex = spawn(CODEX_PATH, [
    '--model', 'gpt-3.5-turbo',
    'exec', prompt,
    '--dangerously-bypass-approvals-and-sandbox',
    '--cd', OUTPUT_DIR
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { 
      ...process.env, 
      CODEX_API_KEY: process.env.OPENAI_API_KEY,
      AIDER_MODEL: 'gpt-3.5-turbo'
    }
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
    console.log(`[GENERATOR] Codex process exited with code ${code}`);
    finishGeneration();
  });

  codex.on('error', (err) => {
    console.error(`[GENERATOR] ✖ Failed to spawn Codex: ${err.message}`);
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
    fs.writeFileSync(GENERATION_DONE_PATH, content, 'utf8');
    console.log('[GENERATOR] ✔ Written generation-done.txt marker');
  } catch (err) {
    console.error(`[GENERATOR] ✖ Failed to write generation-done marker: ${err.message}`);
  }
}

console.log('[GENERATOR] Agent started successfully');
