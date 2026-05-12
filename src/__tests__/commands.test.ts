import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runStatus } from '../commands/status.js';
import { runChanged } from '../commands/changed.js';
import { runDoctor } from '../commands/doctor.js';
import { runMap } from '../commands/map.js';
import { runGuard } from '../commands/guard.js';
import { runPlan } from '../commands/plan.js';
import { runRepo } from '../commands/repo.js';
import { runSummary } from '../commands/summary.js';
import { EXIT } from '../exit-codes.js';

interface Sandbox {
  root: string;
  configPath: string;
  cleanup: () => void;
}

function buildSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'gn-cmd-'));
  // create two repos: lib (clean) and app (dirty + depends on lib)
  const libDir = join(root, 'lib');
  const appDir = join(root, 'app');
  mkdirSync(libDir);
  mkdirSync(appDir);

  for (const dir of [libDir, appDir]) {
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir, stdio: 'ignore' });
  }

  writeFileSync(
    join(libDir, 'package.json'),
    JSON.stringify({ name: '@x/lib', version: '1.0.0' }),
  );
  writeFileSync(join(libDir, 'CLAUDE.md'), '# lib\n');
  execFileSync('git', ['add', '.'], { cwd: libDir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: libDir });

  writeFileSync(
    join(appDir, 'package.json'),
    JSON.stringify({ name: '@x/app', version: '0.1.0', dependencies: { '@x/lib': '^1.0.0' } }),
  );
  execFileSync('git', ['add', '.'], { cwd: appDir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: appDir });

  // Make app dirty to exercise change detection.
  writeFileSync(join(appDir, 'untracked.txt'), 'x');

  const configPath = join(root, 'gitnexus.config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      version: 1,
      repos: [
        { name: 'lib', path: './lib', category: 'package', packageName: '@x/lib', defaultBranch: 'main' },
        { name: 'app', path: './app', category: 'package', packageName: '@x/app', defaultBranch: 'main' },
      ],
    }),
  );

  return {
    root,
    configPath,
    cleanup: () => {
      try { rmSync(root, { recursive: true, force: true }); } catch { /* */ }
    },
  };
}

const cleanupQueue: Array<() => void> = [];
afterEach(() => {
  while (cleanupQueue.length > 0) {
    const fn = cleanupQueue.pop();
    if (fn) try { fn(); } catch { /* */ }
  }
});

describe('CLI command runners', () => {
  it('status returns OK and lists both repos', () => {
    const s = buildSandbox();
    cleanupQueue.push(s.cleanup);
    const result = runStatus({ json: false, noColor: true, configPath: s.configPath, strict: false });
    expect(result.exitCode).toBe(EXIT.OK);
    expect(result.output).toContain('lib');
    expect(result.output).toContain('app');
  });

  it('status --json emits parsable JSON with both repos', () => {
    const s = buildSandbox();
    cleanupQueue.push(s.cleanup);
    const result = runStatus({ json: true, noColor: true, configPath: s.configPath, strict: false });
    const parsed = JSON.parse(result.output) as { repos: Array<{ entry: { name: string } }> };
    expect(parsed.repos.map((r) => r.entry.name).sort()).toEqual(['app', 'lib']);
  });

  it('changed lists app but not lib', () => {
    const s = buildSandbox();
    cleanupQueue.push(s.cleanup);
    const result = runChanged({ json: true, noColor: true, configPath: s.configPath, strict: false });
    const parsed = JSON.parse(result.output) as { count: number; repos: Array<{ entry: { name: string } }> };
    expect(parsed.count).toBe(1);
    expect(parsed.repos[0]?.entry.name).toBe('app');
  });

  it('doctor exits OK when both repos are healthy', () => {
    const s = buildSandbox();
    cleanupQueue.push(s.cleanup);
    const result = runDoctor({ json: false, noColor: true, configPath: s.configPath, strict: false });
    // Repos have no remote so we expect WARN.
    expect([EXIT.OK, EXIT.WARN]).toContain(result.exitCode);
    expect(result.output).toContain('lib');
    expect(result.output).toContain('app');
  });

  it('map shows the inferred dependency edge', () => {
    const s = buildSandbox();
    cleanupQueue.push(s.cleanup);
    const result = runMap({ json: true, noColor: true, configPath: s.configPath, strict: false });
    const parsed = JSON.parse(result.output) as { relations: Array<{ from: string; to: string }> };
    expect(parsed.relations).toEqual([{ from: 'app', to: 'lib', kind: 'depends-on', via: 'package.json', inferred: true }]);
  });

  it('plan orders lib before app', () => {
    const s = buildSandbox();
    cleanupQueue.push(s.cleanup);
    const result = runPlan({ json: true, noColor: true, configPath: s.configPath, strict: false });
    const parsed = JSON.parse(result.output) as { order: string[] };
    expect(parsed.order.indexOf('lib')).toBeLessThan(parsed.order.indexOf('app'));
  });

  it('guard returns WARN for the dirty repo and includes risk codes', () => {
    const s = buildSandbox();
    cleanupQueue.push(s.cleanup);
    const result = runGuard({ json: true, noColor: true, configPath: s.configPath, strict: false });
    expect([EXIT.WARN, EXIT.ERROR]).toContain(result.exitCode);
    const parsed = JSON.parse(result.output) as { repos: Array<{ name: string; risks: Array<{ code: string }> }> };
    const appRepo = parsed.repos.find((r) => r.name === 'app');
    expect(appRepo?.risks.some((r) => r.code === 'UNTRACKED_FILES' || r.code === 'DIRTY_TREE')).toBe(true);
  });

  it('guard --strict escalates WARN to ERROR', () => {
    const s = buildSandbox();
    cleanupQueue.push(s.cleanup);
    const lenient = runGuard({ json: true, noColor: true, configPath: s.configPath, strict: false });
    const strict = runGuard({ json: true, noColor: true, configPath: s.configPath, strict: true });
    if (lenient.exitCode === EXIT.WARN) {
      expect(strict.exitCode).toBe(EXIT.ERROR);
    }
  });

  it('repo <name> returns details for a known repo', () => {
    const s = buildSandbox();
    cleanupQueue.push(s.cleanup);
    const result = runRepo(
      { json: true, noColor: true, configPath: s.configPath, strict: false },
      'lib',
    );
    const parsed = JSON.parse(result.output) as { entry: { name: string } };
    expect(parsed.entry.name).toBe('lib');
  });

  it('repo with unknown name returns BAD_USAGE', () => {
    const s = buildSandbox();
    cleanupQueue.push(s.cleanup);
    const result = runRepo(
      { json: false, noColor: true, configPath: s.configPath, strict: false },
      'banana',
    );
    expect(result.exitCode).toBe(EXIT.BAD_USAGE);
  });

  it('repo without name returns BAD_USAGE', () => {
    const s = buildSandbox();
    cleanupQueue.push(s.cleanup);
    const result = runRepo(
      { json: false, noColor: true, configPath: s.configPath, strict: false },
      undefined,
    );
    expect(result.exitCode).toBe(EXIT.BAD_USAGE);
  });

  it('summary emits one tab-separated line per repo', () => {
    const s = buildSandbox();
    cleanupQueue.push(s.cleanup);
    const result = runSummary({ json: false, noColor: true, configPath: s.configPath, strict: false });
    const lines = result.output.split('\n').filter((l) => l.trim() !== '');
    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect(line.split('\t').length).toBeGreaterThanOrEqual(5);
    }
  });

  it('runs commands without mutating the inspected repos', () => {
    const s = buildSandbox();
    cleanupQueue.push(s.cleanup);

    const before = execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: join(s.root, 'app'), encoding: 'utf8' });
    runStatus({ json: false, noColor: true, configPath: s.configPath, strict: false });
    runGuard({ json: false, noColor: true, configPath: s.configPath, strict: false });
    runDoctor({ json: false, noColor: true, configPath: s.configPath, strict: false });
    const after = execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: join(s.root, 'app'), encoding: 'utf8' });
    expect(after).toBe(before);
  });
});
