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
- **PageIndex integration** — vectorless RAG for reasoning-based scoring
- **Production-grade security** — CSP, WebSocket origin checks, and input sanitization
- **Cost management** — Real-time API token and USD cost tracking dashboard

## Production Hardening (v1.0.0)

CodexMap v1.0.0 introduces critical improvements for reliability and security:

- **Resilient Orchestration**: Agents now feature auto-recovery (restart on crash) and centralized error logging.
- **Security First**: 
    - Content Security Policy (CSP) headers enforced on the dashboard.
    - Local-only WebSocket connectivity to prevent remote hijacking.
    - Path-traversal protection on all management API endpoints.
- **Zero-Dependency Core**: Key agents modified for maximum portability, running even in restricted environments.
- **Cost Transparency**: Live sidebar widget tracks your OpenAI bill in real-time.

## Quick start

### Prerequisites
- Node.js >= 18
- Python >= 3.9
- OpenAI API key with Codex CLI access

### Install

git clone https://github.com/Luciferai04/codexMap
cd codexmap
npm install
pip install -r requirements.txt
cp .env.example .env
# Add your OPENAI_API_KEY to .env

### Run

node orchestrator.js "Build a REST API for a todo app with auth" --auto-heal
open ui/index.html

## Architecture

4 concurrent agents orchestrated around OpenAI Codex CLI:

| Agent | Role |
|---|---|
| Generator | Runs Codex CLI, writes files to ./output |
| Cartographer | Watches filesystem, parses AST, builds graph |
| Broadcaster | WebSocket server, diffs state, pushes to browser |
| Sentinel | Scores nodes via embeddings, detects drift |

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

node scripts/eval/run-all.js

## Tech stack

Node.js · Python · Cytoscape.js · WebSocket · 
OpenAI Codex CLI · OpenAI Embeddings · PageIndex · 
@babel/parser · tree-sitter · chokidar · numpy

## License

MIT
