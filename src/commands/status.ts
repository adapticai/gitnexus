import { inspectAll } from '../inspect.js';
import { formatStatus } from '../format.js';
import { resolveRegistry } from '../registry.js';
import { EXIT } from '../exit-codes.js';
import type { CommandResult, CliOptions } from '../types.js';

export function runStatus(opts: CliOptions): CommandResult {
  const registry = resolveRegistry({ configPath: opts.configPath });
  const states = inspectAll(registry.entries);
  if (opts.json) {
    return {
      exitCode: EXIT.OK,
      output: JSON.stringify({ source: registry.source, registryPath: registry.registryPath ?? null, repos: states }, null, 2),
    };
  }
  return { exitCode: EXIT.OK, output: formatStatus(registry, states) };
}
