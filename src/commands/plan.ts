import { inspectAll } from '../inspect.js';
import { formatPlan } from '../format.js';
import { inferRelations, topologicalOrder } from '../relations.js';
import { resolveRegistry } from '../registry.js';
import { EXIT } from '../exit-codes.js';
import type { CommandResult, CliOptions } from '../types.js';

export function runPlan(opts: CliOptions): CommandResult {
  const registry = resolveRegistry({ configPath: opts.configPath });
  const states = inspectAll(registry.entries);
  const relations = inferRelations(states);
  const { order, cycles } = topologicalOrder(states, relations);

  if (opts.json) {
    return {
      exitCode: EXIT.OK,
      output: JSON.stringify(
        {
          order,
          cycles,
          dirtyRepos: states.filter((s) => s.status?.dirty).map((s) => s.entry.name),
        },
        null,
        2,
      ),
    };
  }
  return { exitCode: EXIT.OK, output: formatPlan(states, order, cycles) };
}
