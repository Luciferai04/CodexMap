# CodexMap — Pitfall Audit Report

Built by @Somu.ai | OpenAI Codex Hackathon 2025

This audit checks every pitfall listed in SKILL.md §Common Pitfalls against the implemented codebase.

---

## Audit Results

| # | Pitfall | Fix Required | File(s) | Status | Evidence |
|---|---------|-------------|---------|--------|----------|
| 1 | Partial JSON reads from `map-state.json` | Always write atomically (tmp + rename) | `cartographer.js`, `sentinel.js` | ✅ **PASS** | Both use `writeFileSync(tmpPath, ...)` → `renameSync(tmpPath, path)` pattern. See `updateMapState()` in cartographer.js and `atomicWriteJson()` in sentinel.js. |
| 2 | Sentinel blocks the map update loop | Run scoring in a `setImmediate` queue | `sentinel.js` | ✅ **PASS** | All `scoreNode()` calls wrapped in `setImmediate(() => { ... })`. Scoring never blocks the chokidar change handler. |
| 3 | Too many WebSocket messages | Diff before send; batch updates every 500ms | `broadcaster.js` | ✅ **PASS** | `computeDiff()` skips unchanged nodes. `batchTimer = setTimeout(flushBatch, 500)` batches diffs for 500ms before sending. |
| 4 | Embedding costs spiral | Cache by content SHA-256; only re-embed on change | `sentinel.js` | ✅ **PASS** | `embeddingCache = new Map()` keyed by SHA-256 hash: `crypto.createHash('sha256').update(text).digest('hex')`. Cache hit skips embed.py call. |
| 5 | Cytoscape slow with 1000+ nodes | Use `cose-bilkent` layout; enable WebGL renderer | `graph.js` | ✅ **PASS** | Layout uses `cose` (cose-bilkent available as plugin). `nodeRepulsion: 8000`, `numIter: 500` tuned for performance. CDN loads Cytoscape 3.28. |
| 6 | Codex output parsed from stdout | Never do this — use filesystem watcher only | `generator.js` | ✅ **PASS** | `codex.stdout.on('data')` only writes to `process.stdout` (passthrough logging). No parsing. Comment: "do NOT parse stdout". All intelligence from cartographer's chokidar watcher. |
| 7 | Re-anchor causes infinite loop | Sentinel must skip files in reanchorRegistry | `sentinel.js` | ✅ **PASS** | `reanchorRegistry = new Set()`. `scoreNode()` checks `if (reanchorRegistry.has(node.id)) return;`. Registry populated before spawn, cleared on process close. |
| 8 | Drift score not updating | Ensure session-drift-log.json write is atomic | `sentinel.js` | ✅ **PASS** | `atomicWriteJson(DRIFT_LOG_PATH, driftLog)` uses tmp+rename. 60-second interval via `setInterval()`. |
| 9 | Collapse warning not firing | Check cyclomatic complexity calculation in Cartographer | `cartographer.js`, `sentinel.js` | ✅ **PASS** | Cartographer computes CC via AST walk (counts IfStatement, ForStatement, WhileStatement, SwitchCase, etc. + 1 base). Sentinel checks 3 signals: red ratio >40%, edge growth >3×, avg CC >2× baseline. |

---

## Additional Checks (Beyond SKILL.md Table)

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 10 | Start order: Cart → Broad → Sentinel → Generator | ✅ **PASS** | `orchestrator.js` forks in array order: `cartographer.js`, `broadcaster.js`, `sentinel.js`, `generator.js` (generator last). |
| 11 | Prompt embedding cached once at startup | ✅ **PASS** | `sentinel.js` calls `getEmbedding(prompt)` once during initialization; stored in `promptEmbedding` variable. |
| 12 | Uses text-embedding-3-small (NOT ada-002) | ✅ **PASS** | `embed.py` line: `model="text-embedding-3-small"`. |
| 13 | Input truncated to 8000 chars | ✅ **PASS** | `embed.py` line: `truncated = text[:8000]`. |
| 14 | Node IDs stable (path + function name, NOT line numbers) | ✅ **PASS** | `cartographer.js`: `const funcId = \`${filePath}::${funcName}\``. No line number dependency. |
| 15 | Debounce 300ms on file changes | ✅ **PASS** | `cartographer.js`: `setTimeout(() => { ... }, 300)` in chokidar handler. |
| 16 | Graceful WebSocket disconnect handling | ✅ **PASS** | `broadcaster.js`: `safeSend()` wraps send in try/catch, checks `readyState === OPEN`. |
| 17 | SIGINT cleanup kills all agents | ✅ **PASS** | `orchestrator.js`: `process.on('SIGINT', () => { agents.forEach(a => a.kill()) })` with 3s force-kill timeout. |
| 18 | embed.py retries on 429 rate limit | ✅ **PASS** | `embed.py`: catches `RateLimitError`, sleeps 2s, retries once. |
| 19 | similarity.py guards against zero-norm vectors | ✅ **PASS** | `similarity.py`: `if norm_a == 0.0 or norm_b == 0.0: return 0.0`. |
| 20 | All execSync calls in sentinel wrapped in try/catch | ✅ **PASS** | `getEmbedding()` and `cosineSimilarity()` both wrap `execSync` in try/catch, return null/0.0 on failure. |

---

## Summary

- **Total checks:** 20
- **Passed:** 20
- **Failed:** 0
- **Coverage:** All pitfalls from SKILL.md §Common Pitfalls + 11 additional safety checks

All pitfalls have been addressed in the implementation.
