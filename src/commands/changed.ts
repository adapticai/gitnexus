import { inspectAll } from '../inspect.js';
import { formatChanged } from '../format.js';
import { resolveRegistry } from '../registry.js';
import { EXIT } from '../exit-codes.js';
import type { CommandResult, CliOptions, RepoState } from '../types.js';

function isInteresting(s: RepoState): boolean {
  const st = s.status;
  if (!st) return false;
  return (
    st.dirty ||
    (st.aheadCount !== null && st.aheadCount > 0) ||
    (st.behindCount !== null && st.behindCount > 0)
  );
}

export function runChanged(opts: CliOptions): CommandResult {
  const registry = resolveRegistry({ configPath: opts.configPath });
  const states = inspectAll(registry.entries);
  const interesting = states.filter(isInteresting);
  if (opts.json) {
    return {
      exitCode: EXIT.OK,
      output: JSON.stringify({ count: interesting.length, repos: interesting }, null, 2),
    };
  }
  return { exitCode: EXIT.OK, output: formatChanged(states) };
}
