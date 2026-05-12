# gitnexus — CLAUDE Code Instructions

`@adaptic/gitnexus` is the cross-repo awareness, diagnostics, and guardrail CLI used across the Adaptic.ai monorepo ecosystem. It is **read-only by design** — no command in this tool may mutate a git repository.

## Build / Test

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build      # produces dist/cli.js with +x
```

Node engine: `>=20`. Single runtime dep: `chalk`. Tests are real-tmp-repo integration tests via `vitest`.

## Architecture invariants

- **No shell exec.** All git invocations go through `runGit` in `src/git.ts` which uses `execFileSync` with an explicit argv array. ESLint blocks `exec` calls (`no-restricted-syntax`).
- **No mutations.** Functions in `src/git.ts` are read-only by intent. Adding any new mutating git command requires explicit code review and a separately-named CLI command (e.g. `gitnexus sync --apply`).
- **Single config schema.** `RegistryFile.version === 1`. Bumping the version is a breaking change.
- **Stable exit codes.** `0` ok, `1` warn, `2` error, `3` bad usage. Treat these as a public contract.
- **Stable risk codes.** Codes in `src/types.ts` (`MISSING_REPO`, `DIRTY_TREE`, …) are part of the public surface. Renaming is a breaking change.

## Code standards

- Strict TypeScript, no `any`.
- Explicit return types on every exported function.
- camelCase / PascalCase / UPPER_SNAKE_CASE conventions.
- JSDoc on every exported symbol.
- Tests must use real tmp git repos (see `src/__tests__/_helpers/tmp-repo.ts`), not mocks.

## When making changes

1. `npm test` must pass before commit.
2. `npm run lint && npm run typecheck` must pass.
3. `npm run build` must succeed and produce an executable `dist/cli.js`.
4. Run `gitnexus status` against `~/adapticai` to sanity-check end-to-end.
5. Commit + push to `origin/main` (this repo's default branch).

## Cross-repo coordination

This tool itself is registered in `~/adapticai/gitnexus.config.json`. Run `gitnexus repo gitnexus` to see its own posture. Schema or risk-code changes here may require updates to consumer documentation across the ecosystem (the `~/adapticai/*/CLAUDE.md` files all reference this tool).
