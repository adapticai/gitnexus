import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TmpRepoOptions {
  initialBranch?: string;
  withInitialCommit?: boolean;
  withRemote?: { name: string; url: string };
  withUpstream?: boolean;
  packageJson?: Record<string, unknown>;
  files?: Record<string, string>;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
}

/**
 * Create a temporary git repo for testing. Always returns an absolute path that
 * the caller is responsible for cleaning up via cleanupTmpRepo.
 */
export function createTmpRepo(opts: TmpRepoOptions = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitnexus-test-'));
  const branch = opts.initialBranch ?? 'main';
  git(dir, ['init', '-b', branch]);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'GitNexus Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);

  if (opts.packageJson) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify(opts.packageJson, null, 2));
  }
  if (opts.files) {
    for (const [relPath, contents] of Object.entries(opts.files)) {
      const full = join(dir, relPath);
      const dirOnly = full.substring(0, full.lastIndexOf('/'));
      if (dirOnly && dirOnly !== dir) {
        mkdirSync(dirOnly, { recursive: true });
      }
      writeFileSync(full, contents);
    }
  }

  if (opts.withInitialCommit !== false) {
    writeFileSync(join(dir, 'README.md'), '# tmp\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', 'initial commit']);
  }

  if (opts.withRemote) {
    git(dir, ['remote', 'add', opts.withRemote.name, opts.withRemote.url]);
  }

  return dir;
}

export function makeDirty(dir: string, mode: 'staged' | 'unstaged' | 'untracked'): void {
  switch (mode) {
    case 'staged':
      writeFileSync(join(dir, 'staged.txt'), 'staged content\n');
      git(dir, ['add', 'staged.txt']);
      break;
    case 'unstaged': {
      writeFileSync(join(dir, 'README.md'), '# tmp modified\n');
      break;
    }
    case 'untracked':
      writeFileSync(join(dir, 'untracked.txt'), 'untracked\n');
      break;
  }
}

export function commitOnce(dir: string, message: string = 'follow-up'): void {
  writeFileSync(join(dir, `file-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`), 'x\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', message]);
}

export function createUpstreamPair(): { upstream: string; downstream: string; cleanup: () => void } {
  const upstream = mkdtempSync(join(tmpdir(), 'gitnexus-upstream-'));
  git(upstream, ['init', '--bare']);

  const downstream = createTmpRepo({ withInitialCommit: true });
  git(downstream, ['remote', 'add', 'origin', upstream]);
  git(downstream, ['push', '-u', 'origin', 'main']);

  return {
    upstream,
    downstream,
    cleanup: () => {
      try { rmSync(upstream, { recursive: true, force: true }); } catch { /* ignore */ }
      try { rmSync(downstream, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

export function detachHead(dir: string): void {
  git(dir, ['checkout', '--detach', 'HEAD']);
}

export function cleanupTmpRepo(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

export function gitRaw(dir: string, args: string[]): string {
  return git(dir, args);
}
