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

// ─── Spawn Codex CLI ────────────────────────────────────────────────────────
// SKILL.md: Always run Codex with --approval-mode auto-edit
const codex = spawn('codex', [prompt], {
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: OUTPUT_DIR,  // Codex writes generated files to the output directory
});

// Pipe stdout through for logging — do NOT parse it
// SKILL.md: "Never parse Codex's output directly — rely on the filesystem watcher"
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

  // Write marker file so Broadcaster can detect completion
  // and send generation_done message
  try {
    fs.writeFileSync(GENERATION_DONE_PATH, new Date().toISOString(), 'utf8');
    console.log('[GENERATOR] ✔ Written generation-done.txt marker');
  } catch (err) {
    console.error(`[GENERATOR] ✖ Failed to write generation-done marker: ${err.message}`);
  }
});

codex.on('error', (err) => {
  console.error(`[GENERATOR] ✖ Failed to spawn Codex: ${err.message}`);
  console.error('[GENERATOR] Make sure "codex" is installed and in your PATH');

  // Still write the marker so the system doesn't hang
  try {
    fs.writeFileSync(
      GENERATION_DONE_PATH,
      `error: ${err.message}\n${new Date().toISOString()}`,
      'utf8'
    );
  } catch (e) {
    // Ignore
  }
});

console.log('[GENERATOR] Agent started successfully');
