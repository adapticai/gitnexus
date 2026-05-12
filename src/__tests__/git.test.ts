import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isGitRepo,
  parsePorcelain,
  readAheadBehind,
  readBranch,
  readGitStatus,
  readHeadCommit,
  readPorcelainStatus,
  readRemoteOrigin,
  readUpstream,
} from '../git.js';
import {
  cleanupTmpRepo,
  commitOnce,
  createTmpRepo,
  createUpstreamPair,
  detachHead,
  gitRaw,
  makeDirty,
} from './_helpers/tmp-repo.js';

const cleanupQueue: Array<() => void> = [];

afterEach(() => {
  while (cleanupQueue.length > 0) {
    const fn = cleanupQueue.pop();
    if (fn) {
      try { fn(); } catch { /* best-effort */ }
    }
  }
});

describe('parsePorcelain', () => {
  it('returns empty arrays for empty input', () => {
    expect(parsePorcelain('')).toEqual({ staged: [], unstaged: [], untracked: [] });
  });

  it('classifies staged, unstaged, and untracked entries', () => {
    // M  staged.txt   <- staged
    //  M unstaged.txt <- unstaged
    // ?? untracked.txt <- untracked
    const input = 'M  staged.txt\0 M unstaged.txt\0?? untracked.txt\0';
    const result = parsePorcelain(input);
    expect(result.staged).toEqual(['staged.txt']);
    expect(result.unstaged).toEqual(['unstaged.txt']);
    expect(result.untracked).toEqual(['untracked.txt']);
  });

  it('handles a file that is both staged and modified', () => {
    const input = 'MM both.txt\0';
    const result = parsePorcelain(input);
    expect(result.staged).toEqual(['both.txt']);
    expect(result.unstaged).toEqual(['both.txt']);
  });

  it('handles renames consuming the old-path token', () => {
    // R  newname.txt\0oldname.txt\0?? loose.txt\0
    const input = 'R  newname.txt\0oldname.txt\0?? loose.txt\0';
    const result = parsePorcelain(input);
    expect(result.staged).toEqual(['newname.txt']);
    expect(result.untracked).toEqual(['loose.txt']);
  });
});

describe('git status against real tmp repos', () => {
  it('reads branch on a fresh repo with one commit', () => {
    const dir = createTmpRepo({ initialBranch: 'main', withInitialCommit: true });
    cleanupQueue.push(() => cleanupTmpRepo(dir));
    expect(isGitRepo(dir)).toBe(true);
    expect(readBranch(dir)).toEqual({ branch: 'main', detached: false });
  });

  it('detects detached HEAD', () => {
    const dir = createTmpRepo({ withInitialCommit: true });
    cleanupQueue.push(() => cleanupTmpRepo(dir));
    commitOnce(dir);
    detachHead(dir);
    const branch = readBranch(dir);
    expect(branch.detached).toBe(true);
    expect(branch.branch).not.toBeNull();
  });

  it('reads upstream and ahead/behind on a paired repo', () => {
    const pair = createUpstreamPair();
    cleanupQueue.push(pair.cleanup);

    expect(readUpstream(pair.downstream)).toBe('origin/main');

    commitOnce(pair.downstream, 'local-only');
    const ab = readAheadBehind(pair.downstream, 'origin/main');
    expect(ab).toEqual({ ahead: 1, behind: 0 });
  });

  it('returns null upstream when no tracking branch exists', () => {
    const dir = createTmpRepo({ withInitialCommit: true });
    cleanupQueue.push(() => cleanupTmpRepo(dir));
    expect(readUpstream(dir)).toBeNull();
  });

  it('reads HEAD commit info', () => {
    const dir = createTmpRepo({ withInitialCommit: true });
    cleanupQueue.push(() => cleanupTmpRepo(dir));
    const head = readHeadCommit(dir);
    expect(head).not.toBeNull();
    expect(head!.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(head!.subject).toBe('initial commit');
    expect(head!.timestamp).toBeGreaterThan(1_000_000_000);
  });

  it('reads remote origin url when set', () => {
    const dir = createTmpRepo({
      withInitialCommit: true,
      withRemote: { name: 'origin', url: 'https://github.com/example/repo.git' },
    });
    cleanupQueue.push(() => cleanupTmpRepo(dir));
    expect(readRemoteOrigin(dir)).toBe('https://github.com/example/repo.git');
  });

  it('returns null remote origin when none configured', () => {
    const dir = createTmpRepo({ withInitialCommit: true });
    cleanupQueue.push(() => cleanupTmpRepo(dir));
    expect(readRemoteOrigin(dir)).toBeNull();
  });

  it('detects staged + unstaged + untracked via porcelain', () => {
    const dir = createTmpRepo({ withInitialCommit: true });
    cleanupQueue.push(() => cleanupTmpRepo(dir));
    makeDirty(dir, 'staged');
    makeDirty(dir, 'unstaged');
    makeDirty(dir, 'untracked');
    const status = readPorcelainStatus(dir);
    expect(status).not.toBeNull();
    expect(status!.staged).toContain('staged.txt');
    expect(status!.unstaged).toContain('README.md');
    expect(status!.untracked).toContain('untracked.txt');
  });

  it('readGitStatus composes everything correctly on a clean repo', () => {
    const dir = createTmpRepo({ withInitialCommit: true });
    cleanupQueue.push(() => cleanupTmpRepo(dir));
    const s = readGitStatus(dir)!;
    expect(s.branch).toBe('main');
    expect(s.dirty).toBe(false);
    expect(s.staged).toEqual([]);
    expect(s.unstaged).toEqual([]);
    expect(s.untracked).toEqual([]);
    expect(s.head?.subject).toBe('initial commit');
    expect(s.hasRemote).toBe(false);
  });

  it('readGitStatus reports dirty when there are changes', () => {
    const dir = createTmpRepo({ withInitialCommit: true });
    cleanupQueue.push(() => cleanupTmpRepo(dir));
    writeFileSync(join(dir, 'newfile.txt'), 'x\n');
    const s = readGitStatus(dir)!;
    expect(s.dirty).toBe(true);
    expect(s.untracked).toContain('newfile.txt');
  });

  it('readGitStatus returns null on a non-repo path', () => {
    expect(readGitStatus('/tmp')).toBeNull();
  });

  it('isGitRepo returns false for a non-existent path', () => {
    expect(isGitRepo('/this/does/not/exist/anywhere/xyz123')).toBe(false);
  });

  it('readGitStatus reads ahead/behind on a paired repo', () => {
    const pair = createUpstreamPair();
    cleanupQueue.push(pair.cleanup);
    commitOnce(pair.downstream);
    const s = readGitStatus(pair.downstream)!;
    expect(s.upstream).toBe('origin/main');
    expect(s.aheadCount).toBe(1);
    expect(s.behindCount).toBe(0);
  });
});

describe('git error tolerance', () => {
  it('readBranch returns null on garbage path', () => {
    expect(readBranch('/nope/nope/nope').branch).toBeNull();
  });

  it('readUpstream returns null on garbage path', () => {
    expect(readUpstream('/nope/nope/nope')).toBeNull();
  });
});

describe('git branch handling on different default branches', () => {
  it('respects explicit initial-branch', () => {
    const dir = createTmpRepo({ initialBranch: 'trunk', withInitialCommit: true });
    cleanupQueue.push(() => cleanupTmpRepo(dir));
    expect(readBranch(dir).branch).toBe('trunk');
  });

  it('reads branch correctly after checkout to new branch', () => {
    const dir = createTmpRepo({ withInitialCommit: true });
    cleanupQueue.push(() => cleanupTmpRepo(dir));
    gitRaw(dir, ['checkout', '-b', 'feature/x']);
    expect(readBranch(dir).branch).toBe('feature/x');
  });
});
