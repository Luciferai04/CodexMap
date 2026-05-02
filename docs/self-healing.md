# Self-Healing Mechanism

CodexMap implements a closed-loop self-healing mechanism to automatically correct architectural drift.

## How it works:
1. **Detection:** When `S_final < 0.40`, a node is marked `red` (drifting).
2. **Re-anchor Trigger:** A user clicks "Re-anchor This Node", or `--auto-heal` triggers it automatically.
3. **Queueing:** The node is placed into `shared/heal-queue.json`.
4. **Correction:** The Generator Agent picks up the node, queries the Codex CLI with the original `prompt.txt` as explicit context, and requests a refactor of the specific function.
5. **Re-evaluation:** The file is saved, triggering Cartographer and Sentinel to parse and re-score the node.
