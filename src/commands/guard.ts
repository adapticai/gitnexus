import { inspectAll } from '../inspect.js';
import { formatGuard } from '../format.js';
import { resolveRegistry } from '../registry.js';
import { EXIT } from '../exit-codes.js';
import { summariseRisks } from '../risks.js';
import type { CommandResult, CliOptions } from '../types.js';

export function runGuard(opts: CliOptions): CommandResult {
  const registry = resolveRegistry({ configPath: opts.configPath });
  const states = inspectAll(registry.entries);

  if (opts.json) {
    let exitCode: number = EXIT.OK;
    for (const s of states) {
      const sum = summariseRisks(s.risks);
      if (sum.errors > 0) exitCode = EXIT.ERROR;
      else if (sum.warnings > 0 && exitCode !== EXIT.ERROR) exitCode = EXIT.WARN;
    }
    if (opts.strict && exitCode === EXIT.WARN) exitCode = EXIT.ERROR;
    return {
      exitCode,
      output: JSON.stringify(
        {
          repos: states.map((s) => ({ name: s.entry.name, path: s.entry.path, risks: s.risks })),
          strict: opts.strict,
        },
        null,
        2,
      ),
    };
  }

  const guard = formatGuard(states);
  let exitCode: number = guard.hasErrors ? EXIT.ERROR : guard.hasWarnings ? EXIT.WARN : EXIT.OK;
  if (opts.strict && exitCode === EXIT.WARN) exitCode = EXIT.ERROR;
  return { exitCode, output: guard.text };
}
