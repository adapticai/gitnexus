import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectAll, inspectRepo } from '../inspect.js';
import { inferRelations, topologicalOrder } from '../relations.js';
import {
  cleanupTmpRepo,
  createTmpRepo,
} from './_helpers/tmp-repo.js';
import type { RegistryEntry } from '../types.js';

const cleanupQueue: Array<() => void> = [];

afterEach(() => {
  while (cleanupQueue.length > 0) {
    const fn = cleanupQueue.pop();
    if (fn) {
      try { fn(); } catch { /* best-effort */ }
    }
  }
});

describe('inspectRepo', () => {
  it('returns MISSING_REPO error for non-existent path', () => {
    const state = inspectRepo({
      name: 'ghost',
      path: '/nope/nope/nope/x',
      category: 'other',
    });
    expect(state.exists).toBe(false);
    expect(state.risks.some((r) => r.code === 'MISSING_REPO')).toBe(true);
  });

  it('returns NOT_GIT_REPO when path exists but is not a git repo', () => {
    const state = inspectRepo({
      name: 'tmp-root',
      path: '/tmp',
      category: 'other',
    });
    if (state.exists) {
      expect(state.risks.some((r) => r.code === 'NOT_GIT_REPO')).toBe(true);
    }
  });

  it('inspects a tmp repo with package.json end-to-end', () => {
    const dir = createTmpRepo({
      withInitialCommit: true,
      packageJson: { name: 'test-pkg', version: '1.2.3', private: false, scripts: { build: 'echo b' } },
    });
    cleanupQueue.push(() => cleanupTmpRepo(dir));
    // Re-commit so the package.json is in HEAD.
    writeFileSync(join(dir, 'CLAUDE.md'), '# project\n');

    const entry: RegistryEntry = {
      name: 'test',
      path: dir,
      category: 'package',
      defaultBranch: 'main',
      packageName: 'test-pkg',
    };
    const state = inspectRepo(entry);
    expect(state.exists).toBe(true);
    expect(state.isGitRepo).toBe(true);
    expect(state.status?.branch).toBe('main');
    expect(state.packageInfo?.name).toBe('test-pkg');
    expect(state.packageInfo?.version).toBe('1.2.3');
    expect(state.hasClaudeMd).toBe(true);
    // CLAUDE.md is untracked -> UNTRACKED_FILES warn
    expect(state.risks.some((r) => r.code === 'UNTRACKED_FILES')).toBe(true);
  });
});

describe('inspectAll + inferRelations + topologicalOrder', () => {
  it('infers dependency edges when one repo depends on another by package name', () => {
    const depDir = createTmpRepo({
      withInitialCommit: true,
      packageJson: { name: '@adaptic/lib', version: '1.0.0', scripts: {} },
    });
    const consumerDir = createTmpRepo({
      withInitialCommit: true,
      packageJson: {
        name: '@adaptic/app',
        version: '1.0.0',
        dependencies: { '@adaptic/lib': '^1.0.0' },
      },
    });
    cleanupQueue.push(() => cleanupTmpRepo(depDir));
    cleanupQueue.push(() => cleanupTmpRepo(consumerDir));

    const states = inspectAll([
      { name: 'lib', path: depDir, category: 'package', packageName: '@adaptic/lib' },
      { name: 'app', path: consumerDir, category: 'package', packageName: '@adaptic/app' },
    ]);
    const relations = inferRelations(states);
    expect(relations).toEqual([
      { from: 'app', to: 'lib', kind: 'depends-on', via: 'package.json', inferred: true },
    ]);

    const { order, cycles } = topologicalOrder(states, relations);
    expect(cycles).toEqual([]);
    // lib must come before app
    expect(order.indexOf('lib')).toBeLessThan(order.indexOf('app'));
  });

  it('handles repos with no package.json gracefully', () => {
    const dir = createTmpRepo({ withInitialCommit: true });
    cleanupQueue.push(() => cleanupTmpRepo(dir));
    const states = inspectAll([
      { name: 'plain', path: dir, category: 'other' },
    ]);
    expect(states[0]?.packageInfo).toBeNull();
    expect(inferRelations(states)).toEqual([]);
  });
});
