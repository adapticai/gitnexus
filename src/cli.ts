#!/usr/bin/env node
/**
 * GitNexus CLI entry point.
 *
 * Hand-rolled argv parser to avoid runtime deps. Supported global flags:
 *   --json            emit JSON output
 *   --no-color        force chalk off
 *   --config <path>   explicit registry path
 *   --strict          escalate warnings to errors (used by guard)
 *   -h, --help        print help
 *   -v, --version     print version
 *
 * Commands: status | changed | doctor | map | guard | plan | repo <name> | summary
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import chalk from 'chalk';
import { runStatus } from './commands/status.js';
import { runChanged } from './commands/changed.js';
import { runDoctor } from './commands/doctor.js';
import { runMap } from './commands/map.js';
import { runGuard } from './commands/guard.js';
import { runPlan } from './commands/plan.js';
import { runRepo } from './commands/repo.js';
import { runSummary } from './commands/summary.js';
import { EXIT } from './exit-codes.js';
import type { CliOptions, CommandResult } from './types.js';

const HELP_TEXT = `${chalk.bold('gitnexus')} — cross-repo awareness for Adaptic.ai

${chalk.bold('USAGE')}
  gitnexus <command> [options]

${chalk.bold('COMMANDS')}
  status              Cross-repo status table.
  changed             Repos with dirty trees, staged files, untracked, or divergence.
  doctor              Verify each registered repo is reachable and healthy.
  map                 Show registry + inferred package.json relationships.
  guard               Risk evaluation; non-zero exit on warnings/errors.
  plan                Suggested execution order for multi-repo changes.
  repo <name>         Detailed view of one repo.
  summary             Compact one-line-per-repo digest (good for agent prompts).

${chalk.bold('GLOBAL OPTIONS')}
  --json              Emit JSON output (machine-readable).
  --no-color          Disable colored output.
  --config <path>     Explicit path to a gitnexus.config.json.
  --strict            For 'guard': escalate warnings to errors.
  -h, --help          Show this help.
  -v, --version       Show version.

${chalk.bold('EXIT CODES')}
  0  ok
  1  warn (informational divergence / missing CLAUDE.md / etc.)
  2  error (missing repo, not a git repo, or --strict + warnings)
  3  bad usage

${chalk.bold('CONFIGURATION')}
  Place a 'gitnexus.config.json' in the directory you want as the registry root.
  GitNexus walks up from the current directory looking for one. If no file is
  found, it auto-discovers sibling .git/ repos under the current directory.
  See 'gitnexus.config.example.json' for the schema.

${chalk.bold('EXAMPLES')}
  gitnexus status
  gitnexus status --json | jq '.repos[] | {name: .entry.name, dirty: .status.dirty}'
  gitnexus guard && git push
  gitnexus repo engine
`;

interface ParsedArgs {
  command: string | null;
  positional: string[];
  options: CliOptions;
  showHelp: boolean;
  showVersion: boolean;
  unknown: string[];
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const unknown: string[] = [];
  const options: CliOptions = { json: false, noColor: false, strict: false };
  let showHelp = false;
  let showVersion = false;

  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === undefined) break;
    switch (a) {
      case '--json':
        options.json = true;
        break;
      case '--no-color':
      case '--no-colour':
        options.noColor = true;
        break;
      case '--strict':
        options.strict = true;
        break;
      case '--config': {
        const next = argv[i + 1];
        if (next === undefined) {
          unknown.push('--config (missing argument)');
        } else {
          options.configPath = next;
          i += 1;
        }
        break;
      }
      case '-h':
      case '--help':
        showHelp = true;
        break;
      case '-v':
      case '--version':
        showVersion = true;
        break;
      default:
        if (a.startsWith('-')) {
          unknown.push(a);
        } else {
          positional.push(a);
        }
    }
    i += 1;
  }

  const command = positional.length > 0 ? (positional[0] ?? null) : null;
  const rest = positional.slice(1);
  return { command, positional: rest, options, showHelp, showVersion, unknown };
}

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/cli.js -> ../package.json
    const pkgPath = join(here, '..', 'package.json');
    const raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown };
    return typeof raw.version === 'string' ? raw.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function dispatch(args: ParsedArgs): CommandResult {
  if (args.showVersion) {
    return { exitCode: EXIT.OK, output: `gitnexus ${readVersion()}` };
  }
  if (args.showHelp || args.command === null) {
    return { exitCode: EXIT.OK, output: HELP_TEXT };
  }
  if (args.unknown.length > 0) {
    return {
      exitCode: EXIT.BAD_USAGE,
      output: chalk.red(`Unknown option(s): ${args.unknown.join(', ')}\n\n${HELP_TEXT}`),
    };
  }

  switch (args.command) {
    case 'status':
      return runStatus(args.options);
    case 'changed':
      return runChanged(args.options);
    case 'doctor':
      return runDoctor(args.options);
    case 'map':
      return runMap(args.options);
    case 'guard':
      return runGuard(args.options);
    case 'plan':
      return runPlan(args.options);
    case 'summary':
      return runSummary(args.options);
    case 'repo':
      return runRepo(args.options, args.positional[0]);
    default:
      return {
        exitCode: EXIT.BAD_USAGE,
        output: chalk.red(`Unknown command: "${args.command}"\n\n${HELP_TEXT}`),
      };
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.options.noColor) {
    // Tell chalk to disable colors. chalk@5 honors NO_COLOR / FORCE_COLOR=0.
    process.env.FORCE_COLOR = '0';
  }

  let result: CommandResult;
  try {
    result = dispatch(args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = { exitCode: EXIT.ERROR, output: chalk.red(`Error: ${message}`) };
  }

  process.stdout.write(result.output + '\n');
  process.exit(result.exitCode);
}

main();
