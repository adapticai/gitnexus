import { inspectAll } from '../inspect.js';
import { formatSummary } from '../format.js';
import { resolveRegistry } from '../registry.js';
import { EXIT } from '../exit-codes.js';
import type { CommandResult, CliOptions } from '../types.js';

export function runSummary(opts: CliOptions): CommandResult {
  const registry = resolveRegistry({ configPath: opts.configPath });
  const states = inspectAll(registry.entries);
  if (opts.json) {
    return {
      exitCode: EXIT.OK,
      output: JSON.stringify(
        {
          source: registry.source,
          repos: states.map((s) => ({
            name: s.entry.name,
            branch: s.status?.branch ?? null,
            dirty: s.status?.dirty ?? null,
            ahead: s.status?.aheadCount ?? null,
            behind: s.status?.behindCount ?? null,
            version: s.packageInfo?.version ?? null,
            errors: s.risks.filter((r) => r.severity === 'error').length,
            warnings: s.risks.filter((r) => r.severity === 'warn').length,
          })),
        },
        null,
        2,
      ),
    };
  }
  return { exitCode: EXIT.OK, output: formatSummary(states) };
}
