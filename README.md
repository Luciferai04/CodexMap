# CodexMap

> Real-time codebase intelligence for AI-generated code.  
> Makes context drift visible, measurable, and self-correcting.

![CodexMap Demo](docs/demo.gif)

## What it does

CodexMap wraps OpenAI Codex CLI with a 4-agent system that generates
a live browser-based node graph of your codebase as it's being written.
Every file and function is color-graded by semantic alignment to your
original prompt. When the AI starts drifting — you see it happen.

## Features

- **Live node graph** — codebase structure forms in real time
- **Drift detection** — cosine similarity scores every node vs your prompt
- **Self-healing** — click any red node to re-anchor it to your intent
- **Architectural collapse warning** — fires when drift compounds systemwide
- **Persistent project graph** — `codexmap index` creates `.codexmap/knowledge-graph.json`
- **Codebase Q&A context** — `ask`, `context`, `diff`, and `onboard` help developers understand a project before or after generation
- **PageIndex integration** — vectorless RAG for reasoning-based scoring
- **Production-grade security** — CSP, WebSocket origin checks, and input sanitization
- **Cost management** — Real-time API token and USD cost tracking dashboard

## Productionization Status

CodexMap is now packaged as a productionizable `0.1.0-alpha.1` local sidecar. It is not a final enterprise release yet, but the runtime is shaped for npm distribution and Codex-first local use:

- **NPX-ready CLI**: `codexmap run`, `watch`, `doctor`, `clean`, `engines`, and `sessions`.
- **Session isolation**: mutable state lives in `.codexmap/sessions/<session-id>/`, not inside the installed package.
- **Engine adapters**: Codex CLI is first-class, with a fake engine for deterministic tests and a boundary for future Claude Code/Gemini/OpenCode adapters.
- **Local security posture**: localhost binding, CSP headers, origin checks, path traversal protection, and redacted diagnostics.
- **Trust path**: fake-engine E2E, package smoke test, CI, and npm provenance publish workflow.

See `PRODUCTION_READINESS.md` for the exact release gates and remaining enterprise-hardening items.

## Quick Start

### Prerequisites
- Node.js >= 18
- Python >= 3.9
- `pipx` for the clean Python-style launcher
- Codex CLI on `PATH` for real generation
- `OPENAI_API_KEY` or `CODEX_API_KEY` for real Codex runs

### One Command

```bash
pipx run codexmap "Build a REST API for todos with auth and PostgreSQL"
```

Installed version:

```bash
pipx install codexmap
codexmap "Build a REST API for todos with auth and PostgreSQL"
```

Node-native fallback:

```bash
npx codexmap "Build a todo app with auth"
```

You can quote the prompt, but you do not have to. CodexMap treats unknown words as the prompt and starts the live drift canvas.

### Advanced Usage

```bash
npx codexmap doctor
npx codexmap index
npx codexmap ask where is authentication handled
npx codexmap context add password reset flow
npx codexmap diff
npx codexmap onboard
```

If you do not want cloud scoring yet:

```bash
npx codexmap "Build a todo app" --no-cloud-scoring
```

Local development:

```bash
CODEXMAP_NPM_SPEC="$PWD" pipx run --spec ./python-wrapper codexmap doctor --no-cloud-scoring
node bin/codexmap.js doctor
node bin/codexmap.js setup --engine fake --no-cloud-scoring
node bin/codexmap.js index
node bin/codexmap.js context "add password reset"
node bin/codexmap.js diff
node bin/codexmap.js "Build a REST API for todos with auth and PostgreSQL" --engine codex
node bin/codexmap.js "Fake test session" --engine fake --no-open --no-cloud-scoring
node bin/codexmap.js watch ./src --prompt "Existing app: detect context drift"
```

## Project understanding commands

CodexMap now has two complementary modes:

- **Project graph mode**: `codexmap index` builds a durable local graph in `.codexmap/knowledge-graph.json`, plus `.codexmap/PROJECT_INDEX.md` and `.codexmap/learn.md`.
- **Live drift mode**: `codexmap run <prompt>` starts the Codex sidecar, watches files as they are generated, scores drift, and enables re-anchor workflows.

Useful graph commands:

```bash
npx codexmap index
npx codexmap ask where is auth implemented
npx codexmap context add password reset emails
npx codexmap diff
npx codexmap onboard
```

The graph mode is local and deterministic. Cloud scoring is only involved in live drift sessions unless you explicitly run with cloud scoring enabled.

## Architecture

Codex-first runtime supervised by the CLI:

| Agent | Role |
|---|---|
| Generator | Runs the selected engine adapter, Codex by default |
| Cartographer | Watches filesystem, parses AST, builds graph |
| Broadcaster | WebSocket server, diffs state, pushes to browser |
| Sentinel | Scores nodes and detects drift |
| Healer | Processes re-anchor queue through the selected engine adapter |

## Scoring formula

S_final = 0.2·S1 + 0.4·S2 + 0.2·A + 0.2·T − 0.3·D

- S1: cosine similarity (OpenAI embeddings)
- S2: PageIndex reasoning score
- A: architectural consistency
- T: type consistency
- D: drift penalty

## Self-healing

Click any red node → Re-anchor → Codex rewrites that file
with your original prompt injected as explicit context.

## Evals

```bash
npm run check
npm test
npm run test:cli-ux
npm run test:e2e:fake
npm run test:e2e:codex   # skipped unless CODEXMAP_RUN_REAL_CODEX_SMOKE=1
npm run test:package
npm run pack:smoke
npm run release:preflight
```

Run the real Codex smoke only when you intentionally want to spend a tiny amount of Codex/OpenAI quota:

```bash
export OPENAI_API_KEY=...
export CODEX_API_KEY="$OPENAI_API_KEY"

CODEXMAP_RUN_REAL_CODEX_SMOKE=1 \
CODEXMAP_CODEX_MODEL=gpt-5.5 \
CODEXMAP_GENERATOR_REASONING_EFFORT=low \
npm run test:e2e:codex
```

## Tech stack

Node.js · Python · Cytoscape.js · WebSocket · 
OpenAI Codex CLI · OpenAI Embeddings · PageIndex · 
@babel/parser · tree-sitter · chokidar · numpy

## License

MIT
