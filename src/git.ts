/**
 * Safe git command execution and structured parsers.
 *
 * Every function in this module:
 *   - shells out via execFileSync with an explicit argv array (never a shell string)
 *   - is read-only — no command here mutates a repo
 *   - tolerates missing repos / missing remotes / detached HEAD without throwing
 */

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { CommitInfo, GitStatus } from './types.js';

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Run `git` with an argv array. Returns structured result; never throws on
 * non-zero exit.
 */
export function runGit(cwd: string, args: readonly string[], timeoutMs: number = DEFAULT_TIMEOUT_MS): RunResult {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: MAX_BUFFER_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    });
    return { ok: true, stdout, stderr: '' };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      ok: false,
      stdout: typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString() ?? ''),
      stderr: typeof e.stderr === 'string' ? e.stderr : (e.stderr?.toString() ?? e.message),
    };
  }
}

export function pathExists(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

export function isGitRepo(cwd: string): boolean {
  if (!pathExists(cwd)) return false;
  try {
    const s = statSync(cwd);
    if (!s.isDirectory()) return false;
  } catch {
    return false;
  }
  if (!pathExists(join(cwd, '.git'))) return false;
  const r = runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  return r.ok && r.stdout.trim() === 'true';
}

export interface BranchInfo {
  branch: string | null;
  detached: boolean;
}

export function readBranch(cwd: string): BranchInfo {
  const r = runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!r.ok) return { branch: null, detached: false };
  const out = r.stdout.trim();
  if (out === 'HEAD' || out === '') {
    const sha = runGit(cwd, ['rev-parse', '--short', 'HEAD']);
    return { branch: sha.ok ? sha.stdout.trim() : null, detached: true };
  }
  return { branch: out, detached: false };
}

export function readUpstream(cwd: string): string | null {
  const r = runGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (!r.ok) return null;
  const out = r.stdout.trim();
  return out === '' ? null : out;
}

export function readRemoteOrigin(cwd: string): string | null {
  const r = runGit(cwd, ['remote', 'get-url', 'origin']);
  if (!r.ok) return null;
  const out = r.stdout.trim();
  return out === '' ? null : out;
}

export function readHeadCommit(cwd: string): CommitInfo | null {
  const r = runGit(cwd, ['log', '-1', '--format=%H%x09%ct%x09%s']);
  if (!r.ok) return null;
  const line = r.stdout.split('\n')[0] ?? '';
  if (line === '') return null;
  const parts = line.split('\t');
  if (parts.length < 3) return null;
  const [hash, timestampStr, ...subjectParts] = parts;
  if (!hash || !timestampStr) return null;
  const timestamp = Number.parseInt(timestampStr, 10);
  if (!Number.isFinite(timestamp)) return null;
  return {
    hash,
    timestamp,
    subject: subjectParts.join('\t'),
  };
}

export interface AheadBehind {
  ahead: number;
  behind: number;
}

export function readAheadBehind(cwd: string, upstream: string): AheadBehind | null {
  const r = runGit(cwd, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`]);
  if (!r.ok) return null;
  const parts = r.stdout.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const behindStr = parts[0];
  const aheadStr = parts[1];
  if (!behindStr || !aheadStr) return null;
  const behind = Number.parseInt(behindStr, 10);
  const ahead = Number.parseInt(aheadStr, 10);
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) return null;
  return { ahead, behind };
}

export interface PorcelainStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

/**
 * Parse `git status --porcelain=v1 -z`.
 *
 * Each entry is `XY <path>\0` (with a second `\0`-terminated path for renames).
 * X is the index status, Y is the working-tree status. `??` means untracked.
 */
export function parsePorcelain(output: string): PorcelainStatus {
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  // Split on NUL but consume rename old-paths as part of the previous entry.
  const tokens = output.split('\0');
  let i = 0;
  while (i < tokens.length) {
    const entry = tokens[i];
    if (entry === undefined || entry === '') {
      i += 1;
      continue;
    }
    if (entry.length < 4) {
      i += 1;
      continue;
    }
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    const x = xy[0];
    const y = xy[1];
    if (xy === '??') {
      untracked.push(path);
    } else {
      if (x && x !== ' ' && x !== '?') staged.push(path);
      if (y && y !== ' ' && y !== '?') unstaged.push(path);
    }
    // Renames consume the *old* path as the next NUL-terminated token.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      i += 2;
    } else {
      i += 1;
    }
  }

  return { staged, unstaged, untracked };
}

export function readPorcelainStatus(cwd: string): PorcelainStatus | null {
  const r = runGit(cwd, ['status', '--porcelain=v1', '-z']);
  if (!r.ok) return null;
  return parsePorcelain(r.stdout);
}

/**
 * Compose the full git status for a repo. Returns `null` only if the directory
 * is not a git working tree.
 */
export function readGitStatus(cwd: string): GitStatus | null {
  if (!isGitRepo(cwd)) return null;

  const { branch, detached } = readBranch(cwd);
  const upstream = detached ? null : readUpstream(cwd);
  const remoteOriginUrl = readRemoteOrigin(cwd);
  const head = readHeadCommit(cwd);
  const porcelain = readPorcelainStatus(cwd) ?? { staged: [], unstaged: [], untracked: [] };

  let aheadCount: number | null = null;
  let behindCount: number | null = null;
  if (upstream) {
    const ab = readAheadBehind(cwd, upstream);
    if (ab) {
      aheadCount = ab.ahead;
      behindCount = ab.behind;
    }
  }

  const dirty =
    porcelain.staged.length > 0 ||
    porcelain.unstaged.length > 0 ||
    porcelain.untracked.length > 0;

  return {
    branch,
    upstream,
    remoteOriginUrl,
    hasRemote: remoteOriginUrl !== null,
    detached,
    dirty,
    staged: porcelain.staged,
    unstaged: porcelain.unstaged,
    untracked: porcelain.untracked,
    aheadCount,
    behindCount,
    head,
  };
}
