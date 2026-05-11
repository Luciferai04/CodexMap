# CodexMap WebSocket Message Contract

## Connection

- **URL:** `ws://localhost:4242` by default. The production CLI injects the selected WebSocket URL into the browser query string and automatically falls back to a free port when 4242 is busy.
- **On connect:** Server sends `full_reset` with complete graph state
- **Reconnection:** Exponential backoff (3s → 15s max)

## Server → Client Messages (15 types)

### 1. `full_reset` — Complete graph state
Sent on initial client connection and when requested.
```json
{
  "type": "full_reset",
  "payload": {
    "nodes": [
      {
        "id": "src/server.js",
        "label": "server.js",
        "type": "file",
        "grade": "green",
        "score": 0.86,
        "path": "src/server.js",
        "lineCount": 45,
        "code": "...",
        "contentHash": "sha256:...",
        "parent": "src"
      }
    ],
    "edges": [
      { "source": "src/server.js", "target": "src/routes/api.js" }
    ]
  }
}
```

### 2. `graph_update` — Incremental node/edge changes
Batched with 500ms debounce after `map-state.json` changes.
```json
{
  "type": "graph_update",
  "payload": {
    "nodes": [
      { "id": "src/new-file.js", "label": "new-file.js", "type": "file", "grade": "pending", ... }
    ],
    "edges": [
      { "source": "src/server.js", "target": "src/new-file.js" }
    ]
  }
}
```

### 3. `node_grade` — Single node grading result
Sent via IPC from Sentinel through Broadcaster.
```json
{
  "type": "node_grade",
  "payload": {
    "id": "src/auth.js",
    "grade": "green",
    "S_final": 0.86,
    "S1": 0.90,
    "S2": 0.80,
    "A": 0.85,
    "T": 0.90,
    "D": 0.05,
    "summary": "Authentication module"
  }
}
```

### 4. `drift_score` — Session drift score
```json
{
  "type": "drift_score",
  "payload": {
    "score": 75,
    "timestamp": "2025-01-01T12:00:00.000Z"
  }
}
```

### 5. `full_drift_history` — Complete drift timeline
```json
{
  "type": "full_drift_history",
  "payload": {
    "snapshots": [
      { "score": 80, "timestamp": "...", "commit": "abc123" }
    ]
  }
}
```

### 6. `collapse_warning` — Architectural collapse detection
```json
{
  "type": "collapse_warning",
  "payload": {
    "triggered": true,
    "signals": {
      "redRatio": 0.72,
      "edgeGrowthRate": 3.5,
      "avgCC": 12
    },
    "reason": "Red node density exceeds 65% threshold"
  }
}
```

### 7. `generation_done` — Codex generation complete
```json
{
  "type": "generation_done",
  "payload": {}
}
```

### 8. `heal_complete` — Self-heal finished
```json
{
  "type": "heal_complete",
  "payload": {
    "nodeId": "src/auth.js",
    "status": "done",
    "timestamp": "2025-01-01T12:00:00.000Z"
  }
}
```

### 9. `heal_status_update` — Heal progress
```json
{
  "type": "heal_status_update",
  "payload": {
    "nodeId": "src/auth.js",
    "status": "healing | done | failed"
  }
}
```

### 10. `drift_history_update` — Drift snapshot update
```json
{
  "type": "drift_history_update",
  "payload": { "snapshots": [...] }
}
```

### 11. `arch_health_update` — Architecture health
```json
{
  "type": "arch_health_update",
  "payload": {
    "health": 85,
    "redRatio": 0.15,
    "maxCC": 8,
    "edgeDensity": 2.3
  }
}
```

### 12. `agent_log` — Single agent log entry
```json
{
  "type": "agent_log",
  "payload": {
    "time": "12:00:00",
    "agent": "SENTINEL",
    "cls": "text-tertiary",
    "msg": "Graded auth.js: green (0.86)"
  }
}
```

### 13. `agent_logs_full` — Bulk agent logs (on connect)
```json
{
  "type": "agent_logs_full",
  "payload": [
    { "time": "...", "agent": "...", "cls": "...", "msg": "..." }
  ]
}
```

### 14. `agent_activity` — Descriptive activity log
```json
{
  "type": "agent_activity",
  "payload": {
    "agent": "Sentinel",
    "action": "Scored auth.js → green (0.86)",
    "timestamp": "2025-01-01T12:00:00.000Z"
  }
}
```

### 15. `settings_update` — Settings state (on connect)
```json
{
  "type": "settings_update",
  "payload": {
    "autoHeal": true
  }
}
```

## Client → Server Messages

### `request_full_reset` — Request complete state
```json
{ "type": "request_full_reset" }
```

### `set_autoheal` — Toggle auto-healing
```json
{ "type": "set_autoheal", "enabled": true }
```

### `manual_heal` — Queue manual heal
```json
{ "type": "manual_heal", "nodeId": "src/auth.js" }
```

## Frontend Integration

### Message Handling (in `ui/index.html`)
The WebSocket dispatcher in `index.html` handles all message types and routes them to the appropriate modules:

- `full_reset` → `CodexGraph.update(payload)`
- `graph_update` → `CodexGraph.update(payload)` or `CodexGraph.applyDiff(payload)`
- `node_grade` → `CodexGraph.updateGrade(id, grade, score)` + `updateScoreTable(payload)`
- `drift_score` → `updateDriftPill(score)` + `DriftTimeline.addPoint({ score, timestamp })`
- `collapse_warning` → `showCollapseBanner(signals)` or `hideCollapseBanner()`
- `generation_done` → `updateStatus('done')` + agent pill update

### Color Updates
Colors are applied via Cytoscape CSS selectors defined in `ui/graph.js`:
- `node[grade="green"]` → teal pastel `#c3faf5` / `#187574`
- `node[grade="yellow"]` → orange pastel `#ffe6cd` / `#d4850a`
- `node[grade="red"]` → coral pastel `#ffc6c6` / `#600000`
- `node[grade="pending"]` → neutral `#f0f0f0` / `#a5a8b5`

Red nodes pulse via Cytoscape animation: `node.animate({ style: { opacity: 0.65 } }, { duration: 1000 })`
