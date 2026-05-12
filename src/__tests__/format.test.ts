import { describe, it, expect } from 'vitest';
import {
  formatChanged,
  formatGuard,
  formatMap,
  formatRepoDetail,
  formatStatus,
  formatSummary,
  formatPlan,
} from '../format.js';
import type { RepoState, ResolvedRegistry } from '../types.js';

function fakeRegistry(): ResolvedRegistry {
  return { source: 'file', registryPath: '/tmp/x/gitnexus.config.json', entries: [] };
}

function fakeState(overrides: Partial<RepoState> = {}): RepoState {
  return {
    entry: {
      name: 'sample',
      path: '/tmp/sample',
      category: 'package',
      packageName: '@adaptic/sample',
      defaultBranch: 'main',
    },
    exists: true,
    isGitRepo: true,
    hasClaudeMd: true,
    status: {
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
      head: { hash: 'a'.repeat(40), timestamp: 1_700_000_000, subject: 'init' },
    },
    packageInfo: {
      manager: 'npm',
      name: '@adaptic/sample',
      version: '1.0.0',
      private: false,
      scripts: { build: 'tsc' },
      dependencies: {},
      devDependencies: {},
      peerDependencies: {},
    },
    risks: [],
    ...overrides,
  };
}

describe('formatters', () => {
  it('formatStatus produces non-empty output for an empty registry', () => {
    const out = formatStatus(fakeRegistry(), []);
    expect(out).toContain('GitNexus');
    expect(out).toContain('(no repos found)');
  });

  it('formatStatus produces a row per repo', () => {
    const out = formatStatus(fakeRegistry(), [fakeState()]);
    expect(out).toContain('sample');
    expect(out).toContain('main');
  });

  it('formatChanged returns a clean message when nothing to show', () => {
    const out = formatChanged([fakeState()]);
    expect(out).toContain('clean and in sync');
  });

  it('formatChanged shows dirty repos', () => {
    const dirty = fakeState({
      status: {
        ...fakeState().status!,
        dirty: true,
        staged: ['a'],
        unstaged: ['b'],
        untracked: ['c'],
      },
    });
    const out = formatChanged([dirty]);
    expect(out).toContain('sample');
    expect(out).toContain('staged');
  });

  it('formatGuard returns no-error message when risks are empty', () => {
    const result = formatGuard([fakeState()]);
    expect(result.hasErrors).toBe(false);
    expect(result.hasWarnings).toBe(false);
  });

  it('formatGuard surfaces error severity', () => {
    const errorState = fakeState({
      risks: [{ severity: 'error', code: 'MISSING_REPO', message: 'gone' }],
    });
    const result = formatGuard([errorState]);
    expect(result.hasErrors).toBe(true);
    expect(result.text).toContain('MISSING_REPO');
  });

  it('formatMap shows nodes and inferred edges', () => {
    const out = formatMap([fakeState()], [
      { from: 'a', to: 'b', kind: 'depends-on', via: 'package.json', inferred: true },
    ]);
    expect(out).toContain('sample');
    expect(out).toContain('depends-on');
  });

  it('formatRepoDetail includes branch and version', () => {
    const out = formatRepoDetail(fakeState());
    expect(out).toContain('main');
    expect(out).toContain('1.0.0');
  });

  it('formatRepoDetail handles missing repo', () => {
    const out = formatRepoDetail(fakeState({ exists: false, isGitRepo: false, status: null }));
    expect(out).toContain('does not exist');
  });

  it('formatSummary emits tab-separated rows', () => {
    const out = formatSummary([fakeState()]);
    expect(out.split('\t').length).toBeGreaterThan(3);
  });

  it('formatPlan numbers the steps', () => {
    const out = formatPlan([fakeState()], ['sample'], []);
    expect(out).toContain('1.');
    expect(out).toContain('sample');
  });
});
