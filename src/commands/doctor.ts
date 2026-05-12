import chalk from 'chalk';
import { inspectAll } from '../inspect.js';
import { resolveRegistry } from '../registry.js';
import { EXIT } from '../exit-codes.js';
import type { CommandResult, CliOptions } from '../types.js';

interface DoctorCheck {
  repo: string;
  path: string;
  exists: boolean;
  isGitRepo: boolean;
  hasRemote: boolean;
  canReadStatus: boolean;
  hasClaudeMd: boolean;
}

export function runDoctor(opts: CliOptions): CommandResult {
  const registry = resolveRegistry({ configPath: opts.configPath });
  const states = inspectAll(registry.entries);

  const checks: DoctorCheck[] = states.map((s) => ({
    repo: s.entry.name,
    path: s.entry.path,
    exists: s.exists,
    isGitRepo: s.isGitRepo,
    hasRemote: s.status?.hasRemote ?? false,
    canReadStatus: s.status !== null,
    hasClaudeMd: s.hasClaudeMd,
  }));

  const failures = checks.filter((c) => !c.exists || !c.isGitRepo || !c.canReadStatus);
  const warnings = checks.filter((c) => c.exists && c.isGitRepo && (!c.hasRemote || !c.hasClaudeMd));

  if (opts.json) {
    const exitCode = failures.length > 0 ? EXIT.ERROR : warnings.length > 0 ? EXIT.WARN : EXIT.OK;
    return {
      exitCode,
      output: JSON.stringify({ checks, failures: failures.length, warnings: warnings.length }, null, 2),
    };
  }

  const lines: string[] = [chalk.bold('GitNexus Doctor'), ''];
  for (const c of checks) {
    const tags: string[] = [];
    tags.push(c.exists ? chalk.green('exists') : chalk.red('missing'));
    tags.push(c.isGitRepo ? chalk.green('git') : chalk.red('not-git'));
    tags.push(c.canReadStatus ? chalk.green('status') : chalk.red('no-status'));
    tags.push(c.hasRemote ? chalk.green('remote') : chalk.yellow('no-remote'));
    tags.push(c.hasClaudeMd ? chalk.green('CLAUDE.md') : chalk.yellow('no-CLAUDE.md'));
    lines.push(`  ${chalk.cyan(c.repo.padEnd(20))} ${tags.join(' · ')}`);
  }
  lines.push('');
  if (failures.length > 0) {
    lines.push(chalk.red(`Doctor: ${failures.length} failure(s).`));
  } else if (warnings.length > 0) {
    lines.push(chalk.yellow(`Doctor: ${warnings.length} warning(s).`));
  } else {
    lines.push(chalk.green('Doctor: all checks passed.'));
  }

  const exitCode = failures.length > 0 ? EXIT.ERROR : warnings.length > 0 ? EXIT.WARN : EXIT.OK;
  return { exitCode, output: lines.join('\n') };
}
