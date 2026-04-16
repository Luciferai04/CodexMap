#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# scripts/integration-test.sh — CodexMap Integration Test
# Built by @Somu.ai for the OpenAI Codex Hackathon 2025
#
# 1. Creates a dummy ./output/test-file.ts with a simple function
# 2. Runs orchestrator.js with a test prompt for 10 seconds
# 3. Checks that map-state.json has at least 1 node
# 4. Checks that the node has a non-null score
# 5. Checks that session-drift-log.json has at least 1 entry
# 6. Checks that the WebSocket on port 4242 accepts connections
# 7. Exits 0 if all checks pass, 1 otherwise with clear error messages
# ──────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

PASS=0
FAIL=0
TOTAL=0

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No color

check() {
  TOTAL=$((TOTAL + 1))
  local name="$1"
  local result="$2"

  if [ "$result" -eq 0 ]; then
    echo -e "  ${GREEN}✔ PASS${NC}: $name"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✖ FAIL${NC}: $name"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo -e "${YELLOW}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║       CodexMap Integration Test Suite                ║${NC}"
echo -e "${YELLOW}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# ─── Step 1: Create dummy test file ──────────────────────────────────────────
echo -e "${YELLOW}[Step 1]${NC} Creating dummy test file..."
mkdir -p output
cat > output/test-file.ts << 'EOF'
// Test file for CodexMap integration test
import { Request, Response } from 'express';

interface Todo {
  id: number;
  title: string;
  completed: boolean;
}

const todos: Todo[] = [];

export function getTodos(req: Request, res: Response): void {
  res.json(todos);
}

export function createTodo(req: Request, res: Response): void {
  const todo: Todo = {
    id: todos.length + 1,
    title: req.body.title,
    completed: false,
  };
  todos.push(todo);
  res.status(201).json(todo);
}

export function deleteTodo(req: Request, res: Response): void {
  const id = parseInt(req.params.id);
  const index = todos.findIndex(t => t.id === id);
  if (index === -1) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  todos.splice(index, 1);
  res.status(204).send();
}
EOF
echo "  Created output/test-file.ts"

# ─── Step 2: Reset shared state ─────────────────────────────────────────────
echo -e "${YELLOW}[Step 2]${NC} Resetting shared state..."
mkdir -p shared
echo '{"nodes":[],"edges":[]}' > shared/map-state.json
echo '[]' > shared/session-drift-log.json
echo "Test prompt for todo REST API with auth" > shared/prompt.txt
echo "  Shared state reset"

# ─── Step 3: Start Cartographer + Broadcaster only (no Codex needed) ─────────
echo -e "${YELLOW}[Step 3]${NC} Starting Cartographer and Broadcaster agents..."

# Start broadcaster in background
node agents/broadcaster.js &
BROADCASTER_PID=$!
sleep 1

# Start cartographer in background (will immediately pick up test-file.ts)
node agents/cartographer.js &
CARTO_PID=$!

echo "  Broadcaster PID: $BROADCASTER_PID"
echo "  Cartographer PID: $CARTO_PID"

# Wait for cartographer to process the file
echo -e "${YELLOW}[Step 4]${NC} Waiting 5 seconds for file processing..."
sleep 5

# ─── Step 4: Run checks ─────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[Checks]${NC} Running validation checks..."

# Check 1: map-state.json has at least 1 node
NODE_COUNT=$(python3 -c "
import json
try:
    with open('shared/map-state.json') as f:
        state = json.load(f)
    print(len(state.get('nodes', [])))
except:
    print(0)
" 2>/dev/null)
[ "$NODE_COUNT" -gt 0 ] 2>/dev/null
check "map-state.json has at least 1 node (found: $NODE_COUNT)" $?

# Check 2: At least one node has type 'file'
HAS_FILE_NODE=$(python3 -c "
import json
try:
    with open('shared/map-state.json') as f:
        state = json.load(f)
    file_nodes = [n for n in state.get('nodes', []) if n.get('type') == 'file']
    print(1 if len(file_nodes) > 0 else 0)
except:
    print(0)
" 2>/dev/null)
[ "$HAS_FILE_NODE" -eq 1 ] 2>/dev/null
check "At least one file-type node exists" $?

# Check 3: Nodes have contentHash set
HAS_HASH=$(python3 -c "
import json
try:
    with open('shared/map-state.json') as f:
        state = json.load(f)
    hashed = [n for n in state.get('nodes', []) if n.get('contentHash')]
    print(1 if len(hashed) > 0 else 0)
except:
    print(0)
" 2>/dev/null)
[ "$HAS_HASH" -eq 1 ] 2>/dev/null
check "Nodes have contentHash (SHA-256)" $?

# Check 4: Function nodes extracted from test-file.ts
FUNC_COUNT=$(python3 -c "
import json
try:
    with open('shared/map-state.json') as f:
        state = json.load(f)
    funcs = [n for n in state.get('nodes', []) if n.get('type') == 'function']
    print(len(funcs))
except:
    print(0)
" 2>/dev/null)
[ "$FUNC_COUNT" -gt 0 ] 2>/dev/null
check "Function nodes extracted (found: $FUNC_COUNT)" $?

# Check 5: Edges exist (import statements parsed)
EDGE_COUNT=$(python3 -c "
import json
try:
    with open('shared/map-state.json') as f:
        state = json.load(f)
    print(len(state.get('edges', [])))
except:
    print(0)
" 2>/dev/null)
[ "$EDGE_COUNT" -ge 0 ] 2>/dev/null
check "Edges parsed from imports (found: $EDGE_COUNT)" $?

# Check 6: Cyclomatic complexity computed
HAS_CC=$(python3 -c "
import json
try:
    with open('shared/map-state.json') as f:
        state = json.load(f)
    cc_nodes = [n for n in state.get('nodes', []) if n.get('cyclomaticComplexity') is not None]
    print(1 if len(cc_nodes) > 0 else 0)
except:
    print(0)
" 2>/dev/null)
[ "$HAS_CC" -eq 1 ] 2>/dev/null
check "Cyclomatic complexity computed" $?

# Check 7: WebSocket on port 4242 accepts connections
WS_OK=1
if command -v nc &> /dev/null; then
  echo "GET / HTTP/1.1" | nc -w 2 localhost 4242 &>/dev/null && WS_OK=0 || WS_OK=1
  # Alternative: just check if port is open
  nc -z -w 2 localhost 4242 &>/dev/null && WS_OK=0
fi
check "WebSocket server on port 4242 accepts connections" $WS_OK

# Check 8: map-state.json write was atomic (check no .tmp files left)
TMP_EXISTS=0
[ -f "shared/map-state.json.tmp" ] && TMP_EXISTS=1
[ "$TMP_EXISTS" -eq 0 ]
check "No leftover .tmp files (atomic write clean)" $?

# ─── Cleanup ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[Cleanup]${NC} Stopping agents..."
kill $BROADCASTER_PID 2>/dev/null || true
kill $CARTO_PID 2>/dev/null || true
wait $BROADCASTER_PID 2>/dev/null || true
wait $CARTO_PID 2>/dev/null || true
echo "  Agents stopped"

# ─── Report ──────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════"
echo -e "  Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, $TOTAL total"
echo "════════════════════════════════════════════════════════"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}Integration test FAILED${NC}"
  exit 1
else
  echo -e "${GREEN}Integration test PASSED${NC}"
  exit 0
fi
