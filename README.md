# GitNexus

Cross-repo awareness, diagnostics, and guard rails for the Adaptic.ai monorepo ecosystem.

GitNexus is the tool Claude Code agents (and humans) use **before, during, and after** multi-repo work to understand what they're about to touch — repo state, branch posture, package relationships, dirty trees, deployment-linked branches, missing documentation. It is read-only by design: no command in GitNexus mutates a repository.

## Why this exists

The Adaptic.ai workspace spans multiple sibling git repositories — `engine`, `utils`, `backend-legacy`, `lumic-utils`, `platform`, `app`, plus the meta `mono` repo — each with its own remote, lifecycle, and deployment posture. Coordinating changes across them safely requires answering, every time:

- Which repos am I about to touch? Are they on the right branch?
- Are there local changes that would be silently mixed into a commit?
- What is the dependency order if I have to bump versions?
- Is this branch protected? Is it deployment-linked?
- Does this repo even have a `CLAUDE.md` to guide automation?

GitNexus answers these in one command, in both human-readable and JSON shapes, with stable exit codes for scripting.

## Install

From a clone:

```bash
cd gitnexus
npm install
npm run build
npm link    # exposes the `gitnexus` command on PATH for the current shell
```

Once linked, run from anywhere:

```bash
gitnexus status
```

To unlink: `npm unlink -g @adaptic/gitnexus`.

## Configuration

GitNexus walks up from the current directory looking for `gitnexus.config.json`. If none is found, it falls back to auto-discovery (scans direct child `.git/` directories of the search root).

A registry file looks like:

```json
{
  "version": 1,
  "discoveryRoot": ".",
  "repos": [
    {
      "name": "engine",
      "path": "./engine",
      "category": "engine",
      "packageName": "@adaptic/engine",
      "defaultBranch": "main",
      "protectedBranches": ["main", "stable"],
      "deploymentEnv": "Railway adaptic-os/stable",
      "related": ["utils", "backend-legacy", "lumic-utils"],
      "owner": "core",
      "allowAgentEdits": true,
      "requiresExtraCaution": true,
      "notes": "Real-time trading engine. Touch start.js with care."
    }
  ]
}
```

Field reference:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Short identifier used in CLI output. |
| `path` | yes | Absolute or relative-to-the-registry path to the working tree. |
| `category` | yes | One of `engine`, `frontend`, `backend`, `package`, `infra`, `agent`, `docs`, `meta`, `other`. |
| `packageName` | no | NPM name. Used to infer cross-repo dependency edges. |
| `defaultBranch` | no | Expected default branch. Mismatch becomes a `WRONG_BRANCH` warning. |
| `protectedBranches` | no | Branches considered protected. Combined with `allowAgentEdits=false` becomes a `PROTECTED_BRANCH` warning. |
| `deploymentEnv` | no | Free-form note about deployment binding. |
| `related` | no | Names of related repos (purely informational). |
| `owner` | no | Human / team owner. |
| `allowAgentEdits` | no | Boolean, defaults to true. False disables agent edits when on a protected branch. |
| `requiresExtraCaution` | no | Boolean, surfaced in detailed views. |
| `notes` | no | Free-form notes. |

See [`gitnexus.config.example.json`](./gitnexus.config.example.json) for a full example.

## Commands

| Command | Purpose |
|---------|---------|
| `gitnexus status` | Cross-repo status table (branch, dirty, sync, version, risk badge). |
| `gitnexus changed` | Repos with dirty trees, staged/unstaged/untracked files, or ahead/behind divergence. |
| `gitnexus doctor` | Verifies each registered path exists, is a git repo, can read status, has a remote. |
| `gitnexus map` | Registry + inferred package.json dependency edges. |
| `gitnexus guard` | Risk evaluation; non-zero exit on warn/error. Use before commits/pushes. |
| `gitnexus plan` | Suggested execution order for multi-repo changes (topological by inferred dependencies). |
| `gitnexus repo <name>` | Detailed view for one repo. |
| `gitnexus summary` | Compact one-line-per-repo digest (good for inclusion in agent prompts). |

### Global options

| Flag | Description |
|------|-------------|
| `--json` | Emit JSON output (machine-readable). |
| `--no-color` | Disable colored output. |
| `--config <path>` | Explicit registry path. |
| `--strict` | For `guard`: escalate warnings to errors. |
| `-h`, `--help` | Show help. |
| `-v`, `--version` | Show version. |

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | OK |
| `1` | WARN (informational divergence, dirty tree, missing CLAUDE.md, etc.) |
| `2` | ERROR (missing repo, not a git repo, or `--strict` + warnings) |
| `3` | BAD_USAGE (unknown command, missing argument) |

## Risk codes

Stable codes returned by `guard` and `repo`:

| Code | Severity | Meaning |
|------|----------|---------|
| `MISSING_REPO` | error | Configured path does not exist. |
| `NOT_GIT_REPO` | error | Path exists but is not a git working tree. |
| `DIRTY_TREE` | warn | Staged, unstaged, or mixed local changes. |
| `UNTRACKED_FILES` | warn | Only untracked files present. |
| `WRONG_BRANCH` | warn | Current branch does not match the registry `defaultBranch`. |
| `PROTECTED_BRANCH` | warn | On a protected branch with `allowAgentEdits=false`. |
| `NO_UPSTREAM` | warn | Branch has no upstream tracking branch. |
| `DETACHED_HEAD` | warn | HEAD is detached. |
| `AHEAD_BEHIND` | warn | Branch diverged from upstream. |
| `NO_REMOTE` | warn | No `origin` remote configured. |
| `NO_CLAUDE_MD` | info | No `CLAUDE.md` at the repo root. |
| `PRIVATE_PACKAGE` | info | Marked private in package.json. |

## Read-only guarantee

GitNexus never:

- runs `git commit`, `git push`, `git pull`, `git fetch`, `git checkout`, or any other state-changing git command
- writes inside a registered repo
- contacts the network

The `child_process` calls always go through `execFileSync` with an explicit argv array — never a shell string. `GIT_TERMINAL_PROMPT=0` and `GIT_OPTIONAL_LOCKS=0` are set on every git invocation so it cannot prompt or take a lock.

If you ever need a mutating mode in the future, it must be a separate, explicit command, named to make the action obvious (e.g. `gitnexus sync --apply`).

## Programmatic API

GitNexus is also importable:

```ts
import { resolveRegistry, inspectAll, evaluateRisks } from '@adaptic/gitnexus';

const registry = resolveRegistry({ configPath: '/abs/path/gitnexus.config.json' });
const states = inspectAll(registry.entries);
for (const s of states) {
  console.log(s.entry.name, s.status?.branch, s.risks.length);
}
```

## Use inside Claude Code

Add this guidance to your `CLAUDE.md`:

> Before starting multi-repo work, before switching branches, and before committing or pushing, run `gitnexus status` and `gitnexus guard`. Use `gitnexus map` and `gitnexus plan` to determine sequencing. If `gitnexus guard` returns non-zero, investigate before proceeding.

## Development

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

## License

MIT.
