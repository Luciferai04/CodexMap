# Recording the CodexMap Demo

## Setup (do this before recording)
1. npm run clean          — clear all previous state
2. Set terminal font size 16px, window 120×40
3. Open ui/index.html in Chrome, DevTools closed
4. Position terminal left half, browser right half

## Recording script (target: 60–90 seconds)

### Scene 1 — Start (0–10s)
node orchestrator.js "Build a Node.js REST API with Express, 
JWT auth, PostgreSQL todos, and user registration" --auto-heal

Watch the 4 agent pills light up in the toolbar.

### Scene 2 — Nodes Appear (10–30s)  
Nodes start appearing on the canvas as Codex generates files.
Point out: teal nodes = aligned, orange = review needed.

### Scene 3 — Edge Connections (30–45s)
Zoom in to show import arrows connecting nodes.
Point out the dashed red cross-contamination edge if one appears.

### Scene 4 — Red Node Appears (45–60s)
A coral/red node appears (off-scope file).
Click it → right panel opens.
Show the score breakdown: S_final low, D penalty high.

### Scene 5 — Re-anchor (60–75s)
Click "Re-anchor This Node".
Watch it heal to green in real time.
Drift score in header drops.

### Scene 6 — Drift Timeline (75–90s)
Point to the sidebar timeline showing the drift history.
Zoom into an inflection annotation if one fired.

## Recommended recording tools
- Mac: Kap (https://getkap.co) — free, exports GIF
- Linux: Peek
- All: OBS → convert with ffmpeg:
  ffmpeg -i demo.mp4 -vf "fps=10,scale=1200:-1" -loop 0 demo.gif

## Target GIF specs
- 1200px wide, 10fps, loop forever
- Under 5MB (GitHub README limit)
- Save to: docs/demo.gif
