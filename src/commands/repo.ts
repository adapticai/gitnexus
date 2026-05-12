import chalk from 'chalk';
import { inspectAll } from '../inspect.js';
import { formatRepoDetail } from '../format.js';
import { resolveRegistry } from '../registry.js';
import { EXIT } from '../exit-codes.js';
import type { CommandResult, CliOptions } from '../types.js';

export function runRepo(opts: CliOptions, repoName: string | undefined): CommandResult {
  if (!repoName) {
    return {
      exitCode: EXIT.BAD_USAGE,
      output: chalk.red('Usage: gitnexus repo <name>'),
    };
  }
  const registry = resolveRegistry({ configPath: opts.configPath });
  const states = inspectAll(registry.entries);
  const state = states.find((s) => s.entry.name === repoName);
  if (!state) {
    const known = states.map((s) => s.entry.name).join(', ');
    return {
      exitCode: EXIT.BAD_USAGE,
      output: chalk.red(`Unknown repo: "${repoName}". Known: ${known || '(none)'}`),
    };
  }
  if (opts.json) {
    return { exitCode: EXIT.OK, output: JSON.stringify(state, null, 2) };
  }
  return { exitCode: EXIT.OK, output: formatRepoDetail(state) };
}
