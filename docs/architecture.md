# CodexMap Architecture

## Agent Start Order (Critical)

Cartographer → Broadcaster → Sentinel → Generator

The Generator MUST start last. If it runs before Broadcaster, 
generated files get no WebSocket listeners.

## Shared State Contract

All agents communicate ONLY through the filesystem:

shared/
  map-state.json          # Live graph (atomic writes only)
  prompt.txt              # Original developer prompt (read-only after init)
  session-drift-log.json  # Drift score history
  api-cost.json           # Running API cost tracker

## WebSocket Message Flow

Generator writes file
  → Cartographer detects (chokidar)
  → Cartographer updates map-state.json (atomic)
  → Broadcaster detects map-state change (chokidar)
  → Broadcaster diffs old vs new state
  → Broadcaster sends graph_update to all WS clients
  → Sentinel detects map-state change
  → Sentinel scores new/changed nodes
  → Sentinel writes scores to map-state.json
  → Broadcaster detects score change
  → Broadcaster sends node_grade to all WS clients
  → UI updates node color

## Scoring Pipeline

S1 = cosine_similarity(embed(node.code), embed(prompt))
S2 = pageindex_reasoning_score(node, prompt)  [gpt-4o-mini]
A  = architectural_consistency(node, green_nodes)
T  = type_consistency(node, prompt_domain)
D  = drift_penalty(node, anti_patterns, import_graph)

S_final = 0.2·S1 + 0.4·S2 + 0.2·A + 0.2·T − 0.3·D
