import { inspectAll } from '../inspect.js';
import { formatMap } from '../format.js';
import { inferRelations } from '../relations.js';
import { resolveRegistry } from '../registry.js';
import { EXIT } from '../exit-codes.js';
import type { CommandResult, CliOptions } from '../types.js';

export function runMap(opts: CliOptions): CommandResult {
  const registry = resolveRegistry({ configPath: opts.configPath });
  const states = inspectAll(registry.entries);
  const relations = inferRelations(states);
  if (opts.json) {
    return {
      exitCode: EXIT.OK,
      output: JSON.stringify({ repos: states.map((s) => s.entry), relations }, null, 2),
    };
  }
  return { exitCode: EXIT.OK, output: formatMap(states, relations) };
}
