# Running Evals

CodexMap comes with a fully automated evaluation suite to benchmark the pipeline's performance.

## Command
`npm run eval`
Or: `node scripts/eval/run-all.js`

## Tests Included
1. **Pipeline Rhythm**: Verifies that WS events are fired in the exact proper order when Cartographer picks up a new AST node.
2. **Scoring Efficacy**: Verifies the cosine similarity outputs against known benchmarks in the `shared/cross-encoder-scores.json`.
3. **Healing Resolution**: Simulates a red node and tests the `orchestrator.js` queue consumption.

## Interpreting Results
The test outputs will print either `PASS` or `FAIL`. Ensure all are passing before cutting any public release.
