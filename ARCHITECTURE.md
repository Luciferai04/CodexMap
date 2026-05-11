# CodexMap Architecture

## System Overview

CodexMap is a real-time multi-agent codebase intelligence dashboard. It watches a codebase directory, parses files into an abstract syntax tree, grades each node (file/function/block) for quality and scope relevance using 5-component scoring, and visualizes the result as a color-coded graph in the browser.

CodexMap now has two graph layers:

1. **Persistent project graph**: created by `codexmap index` in `.codexmap/knowledge-graph.json`. This is a durable understanding layer for project search, onboarding, scoped context, and diff impact reports.
2. **Live session graph**: created during `codexmap run` under `.codexmap/sessions/<session-id>/shared/map-state.json`. This is the real-time drift-control layer used by Cartographer, Sentinel, Broadcaster, and Healer.

## Agent Architecture

| # | Agent | File | Responsibility |
|---|-------|------|---------------|
| A1 | Generator | `agents/generator.js` | Spawns the selected engine adapter, Codex CLI by default |
| A2 | Cartographer | `agents/cartographer.js` | Watches `output/` via chokidar, parses AST (Babel), extracts functions/blocks, builds graph |
| A3 | Broadcaster | `agents/broadcaster.js` | WebSocket server (port 4242), pushes live updates to frontend |
| A4 | Sentinel | `agents/sentinel.js` | Polls `map-state.json` every 3s, grades nodes with 5-component scoring |
| A5 | Historian | `agents/historian.js` | Tracks drift snapshots with git commit history |
| A6 | Architect | `agents/architect.js` | Monitors architecture health (red ratio, complexity, collapse scoring) |
| A7 | Healer | `agents/healer.js` | Self-heals queued nodes through the selected engine adapter |

## Engine Adapter Contract

Every engine adapter must implement the validated contract in `engines/contract.js`:

```js
{
  detect(): Promise<EngineStatus>,
  health(): Promise<EngineHealth>,
  start({ prompt, cwd, outputDir, env, approvalMode }): ChildProcess,
  reanchor({ prompt, filePath, cwd, env }): ChildProcess
}
```

CodexMap never parses engine stdout for intelligence. All code understanding still flows through filesystem changes observed by Cartographer.

## Data Flow

### Pipeline: Project Index → Developer Context
```
codexmap index
  → scans project files with CodexMap ignore defaults and .gitignore hints
  → parses JS/TS with Babel and other text files with line-based extraction
  → creates file, function, class, config, document, and table nodes
  → creates contains/imports relationships
  → writes .codexmap/knowledge-graph.json atomically
  → writes .codexmap/PROJECT_INDEX.md and .codexmap/learn.md

codexmap ask/context/diff/onboard
  → reads the persistent project graph
  → searches relevant nodes and expands one hop through relationships
  → prints scoped context, impact reports, or onboarding guidance
```

### Pipeline: File Change → Graph Update
```
File modified in output/
  → chokidar fires in Cartographer (300ms debounce, 500ms stability)
  → parseFileToNodes() — Babel AST for JS/TS, line-based regex for others
  → extract functions, logic blocks, control flow
  → updateMapState() — merges new nodes into map-state.json (atomic write)
  → chokidar fires in Broadcaster
  → computeDiff() — finds added/changed nodes and edges
  → 500ms batch timer fires → broadcast({ type: 'graph_update', payload: diff })
  → WebSocket → Frontend Cytoscape updates nodes
```

### Pipeline: Grading → Color Update
```
Sentinel polls map-state.json every 3 seconds
  → For each non-directory node: gradeNode(node)
  → Computes S1 (semantic), S2 (BM25), A (arch), T (type), D (drift)
  → S_final = (S1*0.30 + S2*0.20 + A*0.20 + T*0.10) * (1 - D*0.20)
  → grade = green if >= 0.70, yellow if >= 0.40, red if < 0.40
  → If grade changed:
      a) Writes grade/score back to map-state.json in-place
      b) process.send({ type: 'node_grade', payload: { id, grade, score, S1..D } })
  → Orchestrator forwards IPC to Broadcaster
  → Broadcaster broadcasts to all WebSocket clients
  → Frontend CodexGraph.updateGrade(id, grade, score)
  → Cytoscape CSS selector re-evaluates: node[grade="green"] → teal pastel
```

### Pipeline: Self-Healing
```
Healer watches map-state.json (every 5s)
  → Finds nodes with grade === 'red'
  → If autoHeal enabled: enqueues in heal-queue.json
  → Processes queue: spawns Codex CLI with heal prompt
  → On completion: updates heal-queue.json status
  → Cartographer detects rewritten file → re-parses → updates map-state.json
  → Sentinel re-grades on next 3s poll → color updates in frontend
```

## Session Model

Production CLI runs store mutable state under the user's project:

```
.codexmap/sessions/<session-id>/
  session.json
  shared/
    prompt.txt
    map-state.json
    session-drift-log.json
    heal-queue.json
    agent-logs.json
    settings.json
    tracking.json
```

Legacy direct-agent runs still fall back to `codexmap/shared/`.

## Persistent Project Graph

Project-level understanding state lives outside individual sessions:

```
.codexmap/
  knowledge-graph.json
  PROJECT_INDEX.md
  learn.md
  sessions/
    <session-id>/
```

This graph is intentionally separate from live drift state. It can be regenerated at any time with `codexmap index` and used before a run to create better prompts or after a run to inspect impact.

## Shared State Files (`shared/`)

| File | Purpose | Watched By |
|------|---------|-----------|
| `map-state.json` | Live graph state (nodes + edges) | Cartographer (writes), Sentinel (reads), Broadcaster (watches), Healer (watches) |
| `session-drift-log.json` | Drift score time series (array of {score, timestamp}) | Sentinel (appends), Broadcaster (watches) |
| `prompt.txt` | User's original project prompt | Generator (reads), Sentinel (reads) |
| `settings.json` | `{ autoHeal: bool }` | Broadcaster (reads/writes via WS), Healer (reads) |
| `heal-queue.json` | Queue of nodes pending healing | Healer (reads/writes), Broadcaster (watches) |
| `collapse-state.json` | Architectural collapse detection state | Sentinel/Architect (writes), Broadcaster (watches) |
| `agent-logs.json` | Agent activity log for UI feed | All agents (append), Broadcaster (watches) |
| `api-cost.json` | OpenAI API cost tracking | Embed script (writes), Broadcaster (watches) |
| `generation-done.txt` | Generation completion marker | Generator (creates), Broadcaster (watches) |
| `drift-history.json` | Full drift snapshots | Historian (writes), Broadcaster (watches) |
| `arch-health.json` | Architecture health scores | Architect (writes), Broadcaster (watches) |
| `grade-queue.json` | (Legacy — not actively used) | — |

## Ports

| Service | Port | Protocol | Purpose |
|---------|------|----------|---------|
| WebSocket | 4242 | `ws://localhost:4242` | Real-time updates to frontend |
| HTTP UI | 3333 | `http://localhost:3333` | Serves dashboard HTML/CSS/JS + API endpoints |
| Health | 3333 | `http://localhost:3333/api/health` | Diagnostics endpoint |

## Node Schema

```json
{
  "id": "src/server.js",
  "label": "server.js",
  "type": "file | function | block | directory",
  "path": "src/server.js",
  "language": "javascript",
  "code": "// first 2000 chars...",
  "lineCount": 45,
  "score": 0.86,
  "grade": "green | yellow | red | pending",
  "S1": 0.90,
  "S2": 0.80,
  "A": 0.85,
  "T": 0.90,
  "D": 0.05,
  "S_final": 0.86,
  "contentHash": "sha256:...",
  "cyclomaticComplexity": 3,
  "children": ["src/server.js::fn_handleRequest"],
  "parent": "src",
  "drift_signals": [],
  "pageindex_summary": ""
}
```

## Frontend Components

| File | Purpose |
|------|---------|
| `ui/index.html` | Dashboard shell, WebSocket dispatcher, toolbar, sidebar |
| `ui/graph.js` | Cytoscape.js renderer (CodexGraph module) |
| `ui/panel.js` | Right detail panel (CodexPanel module) |
| `ui/drift-timeline.js` | Canvas drift chart (DriftTimeline module) |
| `ui/explorer.js` | Project navigator modal |
| `ui/styles/` | 8 CSS files (Miro design system) |
