import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  REGISTRY_FILE_NAME,
  RegistryError,
  discoverRepos,
  findRegistryFile,
  loadRegistry,
  resolveRegistry,
} from '../registry.js';

const cleanupQueue: Array<() => void> = [];

afterEach(() => {
  while (cleanupQueue.length > 0) {
    const fn = cleanupQueue.pop();
    if (fn) {
      try { fn(); } catch { /* best-effort */ }
    }
  }
});

describe('findRegistryFile', () => {
  it('returns null when none found', () => {
    const empty = mkdtempSync(join(tmpdir(), 'gn-noreg-'));
    cleanupQueue.push(() => rmSync(empty, { recursive: true, force: true }));
    expect(findRegistryFile(empty)).toBeNull();
  });

  it('finds file in current directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gn-reg-'));
    cleanupQueue.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, REGISTRY_FILE_NAME);
    writeFileSync(path, '{"version": 1, "repos": []}');
    expect(findRegistryFile(dir)).toBe(path);
  });

  it('walks up to find registry in ancestor', () => {
    const root = mkdtempSync(join(tmpdir(), 'gn-anc-'));
    cleanupQueue.push(() => rmSync(root, { recursive: true, force: true }));
    const nested = join(root, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    const path = join(root, REGISTRY_FILE_NAME);
    writeFileSync(path, '{"version": 1, "repos": []}');
    expect(findRegistryFile(nested)).toBe(path);
  });
});

describe('loadRegistry', () => {
  it('throws on missing file', () => {
    expect(() => loadRegistry('/nope/nope/nope.json')).toThrow(RegistryError);
  });

  it('throws on malformed JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gn-bad-'));
    cleanupQueue.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, REGISTRY_FILE_NAME);
    writeFileSync(path, '{not json');
    expect(() => loadRegistry(path)).toThrow(/Failed to parse/);
  });

  it('throws on unsupported version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gn-vers-'));
    cleanupQueue.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, REGISTRY_FILE_NAME);
    writeFileSync(path, '{"version": 3, "repos": []}');
    expect(() => loadRegistry(path)).toThrow(/Unsupported registry version/);
  });

  it('throws on a non-numeric version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gn-vers-str-'));
    cleanupQueue.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, REGISTRY_FILE_NAME);
    writeFileSync(path, '{"version": "1", "repos": []}');
    expect(() => loadRegistry(path)).toThrow(/Unsupported registry version/);
  });

  it('accepts a v2 registry and ignores its additive metadata', () => {
    // Regression pin: gitnexus.config.json was bumped to v2 while the loader
    // still hard-required 1, so every command — including `gitnexus guard`,
    // the documented pre-push safety check — aborted with exit 2 and
    // validated nothing. v2 is additive; the parsed entry must match v1.
    const dir = mkdtempSync(join(tmpdir(), 'gn-vers2-'));
    cleanupQueue.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, REGISTRY_FILE_NAME);
    writeFileSync(
      path,
      JSON.stringify({
        version: 2,
        schemaUrl: 'https://example.invalid/gitnexus.schema.json',
        metaRepo: 'mono',
        topicIndex: { trading: ['engine'] },
        repos: [
          {
            name: 'engine',
            path: './engine',
            category: 'engine',
            owner: 'platform',
            purpose: 'trading engine',
            runtime: 'node',
            claudeMd: './engine/CLAUDE.md',
            entrypoints: ['src/server.ts'],
            topics: ['trading'],
            related: ['utils'],
            requiresExtraCaution: true,
          },
        ],
      }),
    );
    const parsed = loadRegistry(path);
    expect(parsed.file.repos).toHaveLength(1);
    expect(parsed.file.repos[0].name).toBe('engine');
    expect(parsed.file.repos[0].category).toBe('engine');
  });

  it('throws on entry with invalid category', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gn-cat-'));
    cleanupQueue.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, REGISTRY_FILE_NAME);
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        repos: [{ name: 'x', path: '/tmp/x', category: 'banana' }],
      }),
    );
    expect(() => loadRegistry(path)).toThrow(/category/);
  });

  it('throws on duplicate repo names', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gn-dup-'));
    cleanupQueue.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, REGISTRY_FILE_NAME);
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        repos: [
          { name: 'x', path: '/tmp/x', category: 'other' },
          { name: 'x', path: '/tmp/y', category: 'other' },
        ],
      }),
    );
    expect(() => loadRegistry(path)).toThrow(/Duplicate/);
  });

  it('resolves relative paths against the registry directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gn-rel-'));
    cleanupQueue.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, REGISTRY_FILE_NAME);
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        repos: [{ name: 'sub', path: './sub', category: 'other' }],
      }),
    );
    const parsed = loadRegistry(path);
    expect(parsed.file.repos[0]?.path).toBe(resolve(dir, 'sub'));
  });

  it('parses a fully-populated entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gn-full-'));
    cleanupQueue.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, REGISTRY_FILE_NAME);
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        repos: [
          {
            name: 'engine',
            path: '/abs/engine',
            category: 'engine',
            packageName: '@adaptic/engine',
            defaultBranch: 'main',
            protectedBranches: ['main', 'stable'],
            deploymentEnv: 'Railway adaptic-os/stable',
            related: ['utils', 'backend-legacy'],
            owner: 'core',
            allowAgentEdits: true,
            requiresExtraCaution: true,
            notes: 'do not touch start.js',
          },
        ],
      }),
    );
    const parsed = loadRegistry(path);
    const entry = parsed.file.repos[0]!;
    expect(entry.packageName).toBe('@adaptic/engine');
    expect(entry.protectedBranches).toEqual(['main', 'stable']);
    expect(entry.requiresExtraCaution).toBe(true);
    expect(entry.notes).toBe('do not touch start.js');
  });
});

describe('discoverRepos', () => {
  it('returns empty when root is missing', () => {
    expect(discoverRepos('/nope/nope/nope')).toEqual([]);
  });

  it('finds direct child .git directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'gn-disc-'));
    cleanupQueue.push(() => rmSync(root, { recursive: true, force: true }));

    // Init two real repos as direct children of root.
    for (const name of ['a', 'b']) {
      const repo = join(root, name);
      mkdirSync(repo, { recursive: false });
      execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore' });
    }

    const found = discoverRepos(root);
    expect(found.length).toBe(2);
    expect(found.map((e) => e.name).sort()).toEqual(['a', 'b']);
    for (const e of found) {
      expect(e.notes).toBe('auto-discovered');
      expect(e.category).toBe('other');
    }
  });

  it('skips non-directories and non-git children', () => {
    const root = mkdtempSync(join(tmpdir(), 'gn-mix-'));
    cleanupQueue.push(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(join(root, 'a-file'), 'x');
    mkdirSync(join(root, 'plain-dir'));
    expect(discoverRepos(root)).toEqual([]);
  });
});

describe('resolveRegistry', () => {
  it('uses explicit configPath when provided', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gn-exp-'));
    cleanupQueue.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, REGISTRY_FILE_NAME);
    writeFileSync(path, '{"version":1,"repos":[]}');
    const r = resolveRegistry({ configPath: path });
    expect(r.source).toBe('file');
    expect(r.registryPath).toBe(path);
  });

  it('falls back to discovery when no registry file is found', () => {
    const root = mkdtempSync(join(tmpdir(), 'gn-fb-'));
    cleanupQueue.push(() => rmSync(root, { recursive: true, force: true }));
    const r = resolveRegistry({ searchFrom: root });
    expect(r.source).toBe('discovery');
    expect(r.entries).toEqual([]);
  });

  it('discovery only when discoveryOnly=true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gn-do-'));
    cleanupQueue.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, REGISTRY_FILE_NAME);
    writeFileSync(path, '{"version":1,"repos":[{"name":"x","path":"/tmp/x","category":"other"}]}');
    const r = resolveRegistry({ searchFrom: dir, discoveryOnly: true });
    expect(r.source).toBe('discovery');
  });
});
