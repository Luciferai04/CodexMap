# CodexMap Troubleshooting Guide

## All nodes are red / no green nodes

**Symptom:** Every node in the graph shows coral (red) color.

**Root cause:** Sentinel scoring weights were hardcoded to sum to 1.30 instead of 1.0, and the drift penalty was doubly-penalized (weighted AND subtracted). This meant even a perfect node scored at most 0.77, and realistic nodes scored 0.16-0.28.

**Fix (applied):**
1. Sentinel now reads weights from `config.js` (sum=1.0)
2. D penalty formula changed from subtraction to multiplier: `S_final = S_base × (1 - D × 0.20)`
3. Thresholds now read from config (green≥0.70, yellow≥0.40)

**Verify:** Restart orchestrator, wait 3-6 seconds, check console for:
```
[SENTINEL] Graded server.js: green (0.86)
```

## Drift score not updating in UI

**Symptom:** Drift pill in top toolbar shows "—" or never changes.

**Root cause:** Sentinel wrote to `drift-log.json` but Broadcaster watched `session-drift-log.json`.

**Fix (applied):** Sentinel now writes to `session-drift-log.json`.

**Verify:** Check `shared/session-drift-log.json` has entries with ISO timestamps.

## WebSocket connection refused

**Check:**
```bash
# Is port 4242 in use?
lsof -i :4242

# Is Broadcaster running?
# Look for: [BROADCASTER] WebSocket server started on ws://0.0.0.0:4242
```

**Fix:** If port is blocked, change `CODEXMAP_PORT` in `.env`.

## Frontend shows skeleton forever

**Check:**
1. Open browser console (F12) for errors
2. Check Network tab — WebSocket should show status 101 (Switching Protocols)
3. Verify HTTP server is running on port 3000

**Common causes:**
- Broadcaster agent crashed
- WebSocket URL wrong in `ui/index.html`
- CORS or firewall blocking localhost

**Fix:** Restart orchestrator, check agent logs in `shared/agent-logs.json`.

## Nodes not appearing in graph

**Check:**
1. Does `output/` directory have files?
2. Is Cartographer watching? Look for: `[CARTOGRAPHER] Watching:`
3. Does `shared/map-state.json` have nodes?
4. Check file permissions on `output/`

**Fix:** Ensure `output/` is not empty and has readable files.

## Auto-heal not working

**Check:**
1. Is `settings.json` set to `{"autoHeal": true}`?
2. Does `heal-queue.json` have pending entries?
3. Is Codex CLI installed? Run: `codex --version`
4. Check Healer agent logs for spawn errors

**Fix:** Enable auto-heal via WebSocket: `{ "type": "set_autoheal", "enabled": true }`

## Duplicate node IDs in graph

**Symptom:** Multiple nodes overlap or graph looks messy.

**Root cause:** Cartographer creates duplicate child IDs for anonymous functions (all named `arrow_anonymous`).

**Fix:** Cartographer should use unique counters: `arrow_fn_0`, `arrow_fn_1`, etc.

## Absolute path IDs breaking lookups

**Symptom:** Some nodes have IDs like `/Users/soumyajitghosh/.../output/app.py` while others are `server.js`.

**Root cause:** Cartographer uses absolute paths for some file types (non-JS/TS).

**Fix:** Normalize all IDs to relative paths relative to `OUTPUT_DIR`.

## OPENAI_API_KEY errors

**Check:**
```bash
# Verify key is set
echo $OPENAI_API_KEY

# Verify key format (should start with sk-)
```

**Fix:** Add to `.env` file:
```env
OPENAI_API_KEY=sk-your-key-here
```

## High OpenAI costs

**Check:** `shared/api-cost.json` for total spend.

**Fix:** Set cost cap in `.env`:
```env
CODEXMAP_COST_CAP_USD=5.00
```

## Rate limiting errors (429)

**Cause:** Too many API calls in short time.

**Fix:**
- Increase delay between calls
- Use embedding cache (automatic)
- Lower `CODEXMAP_COST_CAP_USD`

## Session recovery

After a crash, state is preserved in `shared/map-state.json`. To resume:
```bash
node orchestrator.js "Your prompt" --reload
```

## Debug Mode

To see verbose agent logs:
```bash
# Tail agent logs in real-time
tail -f shared/agent-logs.json | python3 -m json.tool
```

## Known Limitations

1. **Tree-sitter not integrated** — Python/Go files use line-based regex parsing (less accurate than Babel)
2. **No incremental embedding** — All embeddings are computed fresh (cache helps but doesn't prevent initial cost)
3. **Sentinel polling** — Grades every 3s regardless of whether nodes changed (CPU-intensive for large codebases)
4. **No auth on WebSocket** — Any local process can connect (fine for dev, not for production)
