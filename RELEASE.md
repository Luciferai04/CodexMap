# CodexMap Release Checklist

CodexMap should ship public releases only through the npm package path.

## Preflight

```bash
npm run release:preflight
```

This verifies:

- JavaScript syntax for CLI, agents, server, engines, and libraries.
- Unit coverage for argument parsing, config fallback, sessions, atomic writes, and engine contract validation.
- CLI UX coverage for `setup`, local config, JSON doctor output, and no-cloud-scoring onboarding.
- Package contents exclude local runtime state, backup scripts, `.env`, `.codexmap`, `shared/`, and development fix scripts.
- Fake-engine E2E proves the `npx codexmap run` path can create files, map nodes, and serve state.
- Real-Codex smoke test is present but skipped unless explicitly enabled.
- Package tarball installs and `npx codexmap doctor` runs from the installed tarball.
- Python wrapper syntax passes so `pipx run codexmap` can delegate to the npm package.
- `git diff --check` has no whitespace errors.

## Package Names

Registry checks on 2026-05-10 showed both package names available:

- npm: `codexmap`
- PyPI/pipx: `codexmap`

The npm package is the source of truth. The PyPI package is a thin launcher that delegates to `npx -y codexmap@0.1.0-alpha.1`.

## Real Codex Gate

Run only when you intentionally want to spend a small amount of Codex/OpenAI quota:

```bash
export OPENAI_API_KEY=...
export CODEX_API_KEY="$OPENAI_API_KEY"

CODEXMAP_RUN_REAL_CODEX_SMOKE=1 \
CODEXMAP_CODEX_MODEL=gpt-5.5 \
CODEXMAP_GENERATOR_REASONING_EFFORT=low \
npm run test:e2e:codex
```

The test creates a temporary project, asks Codex to write a tiny `index.js`, waits for Cartographer to map it, then shuts down the local sidecar.
It requires `OPENAI_API_KEY` or `CODEX_API_KEY`; Codex CLI login alone can report logged-in while still returning `401 Unauthorized` from `codex exec`.

## Publish

Publishing should use GitHub Actions trusted publishing with provenance:

1. Confirm `npm run release:preflight` passes locally.
2. Confirm the real Codex smoke has passed in a configured environment.
3. Tag the release, for example `v0.1.0-alpha.1`.
4. Run the `Publish` workflow. Alpha prereleases publish with the `alpha` npm tag.

Manual publish fallback:

```bash
npm publish --provenance --access public --tag alpha
```

Do not publish from a machine containing unrotated secrets in the working tree.
