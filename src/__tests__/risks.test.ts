import { describe, it, expect } from 'vitest';
import { evaluateRisks, summariseRisks } from '../risks.js';
import type { GitStatus, PackageInfo, RegistryEntry } from '../types.js';

function entry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    name: 'x',
    path: '/tmp/x',
    category: 'other',
    ...overrides,
  };
}

function status(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    branch: 'main',
    upstream: 'origin/main',
    remoteOriginUrl: 'git@example:x/y.git',
    hasRemote: true,
    detached: false,
    dirty: false,
    staged: [],
    unstaged: [],
    untracked: [],
    aheadCount: 0,
    behindCount: 0,
    head: { hash: 'a'.repeat(40), timestamp: 1, subject: 'initial' },
    ...overrides,
  };
}

const cleanPkg: PackageInfo = {
  manager: 'npm',
  name: '@x/y',
  version: '1.0.0',
  private: false,
  scripts: {},
  dependencies: {},
  devDependencies: {},
  peerDependencies: {},
};

describe('evaluateRisks', () => {
  it('emits MISSING_REPO when path does not exist', () => {
    const r = evaluateRisks({
      entry: entry(),
      exists: false,
      isGitRepo: false,
      status: null,
      packageInfo: null,
      hasClaudeMd: false,
    });
    expect(r.map((f) => f.code)).toContain('MISSING_REPO');
    expect(r[0]?.severity).toBe('error');
  });

  it('emits NOT_GIT_REPO when path exists but is not a git repo', () => {
    const r = evaluateRisks({
      entry: entry(),
      exists: true,
      isGitRepo: false,
      status: null,
      packageInfo: null,
      hasClaudeMd: false,
    });
    expect(r.map((f) => f.code)).toContain('NOT_GIT_REPO');
  });

  it('emits DIRTY_TREE when tracked files are staged', () => {
    const r = evaluateRisks({
      entry: entry(),
      exists: true,
      isGitRepo: true,
      status: status({ dirty: true, staged: ['a'], unstaged: [], untracked: [] }),
      packageInfo: null,
      hasClaudeMd: true,
    });
    expect(r.map((f) => f.code)).toContain('DIRTY_TREE');
  });

  it('emits UNTRACKED_FILES (and not DIRTY_TREE) when only untracked are present', () => {
    const r = evaluateRisks({
      entry: entry(),
      exists: true,
      isGitRepo: true,
      status: status({ dirty: true, staged: [], unstaged: [], untracked: ['x.txt'] }),
      packageInfo: null,
      hasClaudeMd: true,
    });
    const codes = r.map((f) => f.code);
    expect(codes).toContain('UNTRACKED_FILES');
    expect(codes).not.toContain('DIRTY_TREE');
  });

  it('emits both DIRTY_TREE and UNTRACKED_FILES when both are present', () => {
    const r = evaluateRisks({
      entry: entry(),
      exists: true,
      isGitRepo: true,
      status: status({ dirty: true, staged: ['a'], unstaged: [], untracked: ['b'] }),
      packageInfo: null,
      hasClaudeMd: true,
    });
    const codes = r.map((f) => f.code);
    expect(codes).toContain('DIRTY_TREE');
    expect(codes).toContain('UNTRACKED_FILES');
  });

  it('emits WRONG_BRANCH when on a non-default branch', () => {
    const r = evaluateRisks({
      entry: entry({ defaultBranch: 'main' }),
      exists: true,
      isGitRepo: true,
      status: status({ branch: 'feature/x' }),
      packageInfo: null,
      hasClaudeMd: true,
    });
    expect(r.map((f) => f.code)).toContain('WRONG_BRANCH');
  });

  it('emits PROTECTED_BRANCH when on a protected branch with edits disabled', () => {
    const r = evaluateRisks({
      entry: entry({ protectedBranches: ['main'], allowAgentEdits: false }),
      exists: true,
      isGitRepo: true,
      status: status({ branch: 'main' }),
      packageInfo: null,
      hasClaudeMd: true,
    });
    expect(r.map((f) => f.code)).toContain('PROTECTED_BRANCH');
  });

  it('does not emit PROTECTED_BRANCH when allowAgentEdits is unset', () => {
    const r = evaluateRisks({
      entry: entry({ protectedBranches: ['main'] }),
      exists: true,
      isGitRepo: true,
      status: status({ branch: 'main' }),
      packageInfo: null,
      hasClaudeMd: true,
    });
    expect(r.map((f) => f.code)).not.toContain('PROTECTED_BRANCH');
  });

  it('emits DETACHED_HEAD on detached', () => {
    const r = evaluateRisks({
      entry: entry(),
      exists: true,
      isGitRepo: true,
      status: status({ detached: true, upstream: null }),
      packageInfo: null,
      hasClaudeMd: true,
    });
    expect(r.map((f) => f.code)).toContain('DETACHED_HEAD');
  });

  it('emits NO_REMOTE when no origin', () => {
    const r = evaluateRisks({
      entry: entry(),
      exists: true,
      isGitRepo: true,
      status: status({ hasRemote: false, remoteOriginUrl: null, upstream: null, aheadCount: null, behindCount: null }),
      packageInfo: null,
      hasClaudeMd: true,
    });
    expect(r.map((f) => f.code)).toContain('NO_REMOTE');
  });

  it('emits NO_UPSTREAM when remote exists but no upstream', () => {
    const r = evaluateRisks({
      entry: entry(),
      exists: true,
      isGitRepo: true,
      status: status({ upstream: null, aheadCount: null, behindCount: null }),
      packageInfo: null,
      hasClaudeMd: true,
    });
    expect(r.map((f) => f.code)).toContain('NO_UPSTREAM');
  });

  it('emits AHEAD_BEHIND when diverged', () => {
    const r = evaluateRisks({
      entry: entry(),
      exists: true,
      isGitRepo: true,
      status: status({ aheadCount: 2, behindCount: 0 }),
      packageInfo: null,
      hasClaudeMd: true,
    });
    expect(r.map((f) => f.code)).toContain('AHEAD_BEHIND');
  });

  it('emits NO_CLAUDE_MD when missing', () => {
    const r = evaluateRisks({
      entry: entry(),
      exists: true,
      isGitRepo: true,
      status: status(),
      packageInfo: null,
      hasClaudeMd: false,
    });
    expect(r.map((f) => f.code)).toContain('NO_CLAUDE_MD');
  });

  it('emits PRIVATE_PACKAGE for private packages', () => {
    const r = evaluateRisks({
      entry: entry(),
      exists: true,
      isGitRepo: true,
      status: status(),
      packageInfo: { ...cleanPkg, private: true },
      hasClaudeMd: true,
    });
    expect(r.map((f) => f.code)).toContain('PRIVATE_PACKAGE');
  });

  it('returns empty for a perfectly clean repo with everything in order', () => {
    const r = evaluateRisks({
      entry: entry({ defaultBranch: 'main' }),
      exists: true,
      isGitRepo: true,
      status: status(),
      packageInfo: cleanPkg,
      hasClaudeMd: true,
    });
    expect(r).toEqual([]);
  });
});

describe('summariseRisks', () => {
  it('counts severities correctly', () => {
    const summary = summariseRisks([
      { severity: 'error', code: 'MISSING_REPO', message: '' },
      { severity: 'warn', code: 'DIRTY_TREE', message: '' },
      { severity: 'warn', code: 'AHEAD_BEHIND', message: '' },
      { severity: 'info', code: 'NO_CLAUDE_MD', message: '' },
    ]);
    expect(summary).toEqual({ errors: 1, warnings: 2, infos: 1 });
  });
});
