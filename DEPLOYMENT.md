# CodexMap Deployment Guide

## Prerequisites

- **Node.js** 18+ (for agents, HTTP server, WebSocket)
- **Python** 3.9+ (for embedding/scoring scripts)
- **OpenAI API key** (for embeddings and auto-labeling)
- **OpenAI Codex CLI** installed and in PATH (for code generation and healing)

## Quick Start

```bash
# 1. Navigate to the project
cd "Code Generation Map/codexmap"

# 2. Install dependencies
npm install
pip install -r requirements.txt

# 3. Create .env file (see Configuration below)

# 4. Run the npm-style CLI sidecar
node bin/codexmap.js run "Build a banking app with auth, payments, and user management"
```

## Configuration

Create a `.env` file in the `codexmap/` directory:

```env
# === OpenAI ===
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
EMBEDDING_MODEL=text-embedding-3-small

# === Ports ===
CODEXMAP_PORT=4242        # WebSocket
CODEXMAP_HTTP_PORT=3333   # HTTP UI

# === Paths ===
CODEXMAP_OUTPUT_DIR=./output       # Where generated code goes
CODEXMAP_SHARED_DIR=./shared       # Shared state files
CODEXMAP_CLOUD_SCORING=true        # Set false for local-only heuristic scoring

# === Scoring Weights (must sum to 1.0) ===
WEIGHT_S1=0.30    # Semantic similarity
WEIGHT_S2=0.20    # BM25 sparse scoring
WEIGHT_A=0.20     # Architectural consistency
WEIGHT_T=0.10     # Code quality / type safety
WEIGHT_D=0.20     # Drift penalty

# === Grade Thresholds ===
THRESHOLD_GREEN=0.75
THRESHOLD_YELLOW=0.40
AUTO_HEAL_THRESHOLD=0.40

# === Collapse Detection ===
COLLAPSE_RED_DENSITY=0.65
COLLAPSE_EDGE_MULT=3.0
COLLAPSE_CC_MULT=2.0

# === Cost Cap (USD) ===
CODEXMAP_COST_CAP_USD=5.00
```

## Running Modes

### NPX/CLI Launcher
```bash
codexmap run "Your prompt"
```
- Creates `.codexmap/sessions/<session-id>/`
- Starts HTTP server on port 3333, or the next free port
- Opens browser automatically
- Runs orchestrator with all agents

### Watch Existing Project
```bash
codexmap watch ./src --prompt "Original project intent"
```

### Doctor
```bash
codexmap doctor
```
Checks Node, Python, OpenAI key, Codex CLI, writable session directory, and port availability.

### Direct Orchestrator
```bash
# Basic
node orchestrator.js "Your prompt"

# With auto-healing
node orchestrator.js "Your prompt" --auto-heal

# With PageIndex integration
node orchestrator.js "Your prompt" --use-pageindex

# Watch external directory
node orchestrator.js "Your prompt" --watch /path/to/your/project

# Reload previous session
node orchestrator.js "Your prompt" --reload
```

### Serve Only (no agents)
```bash
node serve.js
```
Serves the UI on port 3333 with API endpoints but does not start agents.

## Accessing the Dashboard

| URL | Purpose |
|-----|---------|
| `http://localhost:3333/?project=MyProject` | Main dashboard |
| `http://localhost:3333/api/health` | Health diagnostics |
| `ws://localhost:4242` | WebSocket connection |

## Stopping

Press `Ctrl+C` in the terminal running the orchestrator. All agents are gracefully shut down and state is preserved.

## Architecture Overview

See `ARCHITECTURE.md` for the full 7-agent system design.

## Scoring System

See `SCORING.md` for the 5-component scoring formula, weights, and thresholds.

## WebSocket Contract

See `WEBSOCKET.md` for all 15+ message types with JSON payloads.
