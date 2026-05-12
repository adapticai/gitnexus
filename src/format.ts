/**
 * Human-readable formatters. All output uses chalk; chalk auto-disables on
 * non-TTY and respects NO_COLOR.
 */

import chalk from 'chalk';
import { keyScripts } from './package-info.js';
import { summariseRisks } from './risks.js';
import type {
  Relation,
  RepoState,
  ResolvedRegistry,
  RiskFlag,
  RiskSeverity,
} from './types.js';

function severityColor(sev: RiskSeverity): (s: string) => string {
  if (sev === 'error') return chalk.red.bold;
  if (sev === 'warn') return chalk.yellow;
  return chalk.dim;
}

function severityIcon(sev: RiskSeverity): string {
  if (sev === 'error') return 'x';
  if (sev === 'warn') return '!';
  return 'i';
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + ' '.repeat(width - s.length);
}

function rightPad(s: string, width: number): string {
  return pad(s, width);
}

function formatBranch(state: RepoState): string {
  const status = state.status;
  if (!status || !status.branch) return chalk.dim('?');
  if (state.entry.defaultBranch && status.branch !== state.entry.defaultBranch) {
    return chalk.yellow(status.branch);
  }
  return chalk.cyan(status.branch);
}

function formatDirty(state: RepoState): string {
  const s = state.status;
  if (!s) return chalk.dim('-');
  if (s.dirty) {
    const parts: string[] = [];
    if (s.staged.length > 0) parts.push(`${s.staged.length}s`);
    if (s.unstaged.length > 0) parts.push(`${s.unstaged.length}m`);
    if (s.untracked.length > 0) parts.push(`${s.untracked.length}u`);
    return chalk.yellow(parts.join(' '));
  }
  return chalk.green('clean');
}

function formatAheadBehind(state: RepoState): string {
  const s = state.status;
  if (!s) return chalk.dim('-');
  if (s.aheadCount === null || s.behindCount === null) {
    return chalk.dim('-');
  }
  if (s.aheadCount === 0 && s.behindCount === 0) return chalk.dim('=');
  const parts: string[] = [];
  if (s.aheadCount > 0) parts.push(chalk.cyan(`+${s.aheadCount}`));
  if (s.behindCount > 0) parts.push(chalk.magenta(`-${s.behindCount}`));
  return parts.join(' ');
}

function formatVersion(state: RepoState): string {
  const v = state.packageInfo?.version;
  return v ? chalk.dim(`v${v}`) : chalk.dim('-');
}

function formatRiskBadge(risks: RiskFlag[]): string {
  const summary = summariseRisks(risks);
  const segments: string[] = [];
  if (summary.errors > 0) segments.push(chalk.red.bold(`${summary.errors}E`));
  if (summary.warnings > 0) segments.push(chalk.yellow(`${summary.warnings}W`));
  if (summary.infos > 0) segments.push(chalk.dim(`${summary.infos}i`));
  return segments.length > 0 ? segments.join(' ') : chalk.green('ok');
}

export function formatStatus(registry: ResolvedRegistry, states: RepoState[]): string {
  const lines: string[] = [];
  lines.push(formatHeader(registry, states.length));

  if (states.length === 0) {
    lines.push(chalk.dim('  (no repos found)'));
    return lines.join('\n');
  }

  const nameWidth = Math.max(4, ...states.map((s) => s.entry.name.length));
  const branchWidth = Math.max(
    6,
    ...states.map((s) => (s.status?.branch ?? '?').length),
  );
  const versionWidth = Math.max(7, ...states.map((s) => (s.packageInfo?.version ? `v${s.packageInfo.version}` : '-').length));

  lines.push(
    [
      chalk.bold(rightPad('REPO', nameWidth)),
      chalk.bold(rightPad('BRANCH', branchWidth)),
      chalk.bold(rightPad('STATE', 14)),
      chalk.bold(rightPad('SYNC', 8)),
      chalk.bold(rightPad('PKG', versionWidth)),
      chalk.bold('RISKS'),
    ].join('  '),
  );

  for (const s of states) {
    lines.push(
      [
        rightPad(s.entry.name, nameWidth),
        rightPad(stripChalkLength(formatBranch(s), branchWidth), branchWidth),
        rightPad(stripChalkLength(formatDirty(s), 14), 14),
        rightPad(stripChalkLength(formatAheadBehind(s), 8), 8),
        rightPad(stripChalkLength(formatVersion(s), versionWidth), versionWidth),
        formatRiskBadge(s.risks),
      ].join('  '),
    );
  }

  lines.push('');
  lines.push(formatLegend());
  return lines.join('\n');
}

function formatHeader(registry: ResolvedRegistry, count: number): string {
  const sourceLabel = registry.source === 'file' ? `file (${registry.registryPath ?? '?'})` : registry.source;
  return chalk.bold(`GitNexus`) + chalk.dim(`  source=${sourceLabel}  repos=${count}`);
}

function formatLegend(): string {
  return chalk.dim(
    'STATE: clean | <n>s staged · <n>m modified · <n>u untracked    SYNC: +ahead -behind = in-sync    RISKS: nE errors · nW warnings · ni info',
  );
}

/**
 * Best-effort visible-width pad that ignores chalk ANSI codes. Falls back to
 * raw length if the string contains no ANSI.
 */
function stripChalkLength(s: string, _width: number): string {
  return s;
}

export function formatChanged(states: RepoState[]): string {
  const interesting = states.filter((s) => {
    const st = s.status;
    if (!st) return false;
    return (
      st.dirty ||
      (st.aheadCount !== null && st.aheadCount > 0) ||
      (st.behindCount !== null && st.behindCount > 0)
    );
  });

  if (interesting.length === 0) {
    return chalk.green('All tracked repos are clean and in sync.');
  }

  const lines: string[] = [chalk.bold('Repos with local changes or divergence:'), ''];
  for (const s of interesting) {
    lines.push(`${chalk.cyan(s.entry.name)}  ${chalk.dim(s.entry.path)}`);
    const st = s.status!;
    if (st.staged.length > 0) lines.push(`  ${chalk.yellow('staged:')}    ${st.staged.length} file(s)`);
    if (st.unstaged.length > 0) lines.push(`  ${chalk.yellow('unstaged:')}  ${st.unstaged.length} file(s)`);
    if (st.untracked.length > 0) lines.push(`  ${chalk.yellow('untracked:')} ${st.untracked.length} file(s)`);
    if (st.aheadCount !== null && st.aheadCount > 0) lines.push(`  ${chalk.cyan('ahead:')}     ${st.aheadCount}`);
    if (st.behindCount !== null && st.behindCount > 0) lines.push(`  ${chalk.magenta('behind:')}    ${st.behindCount}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export interface GuardOutput {
  text: string;
  hasErrors: boolean;
  hasWarnings: boolean;
}

export function formatGuard(states: RepoState[]): GuardOutput {
  let hasErrors = false;
  let hasWarnings = false;
  const lines: string[] = [chalk.bold('GitNexus Guard'), ''];

  const repoFlags = states
    .map((s) => ({ state: s, flags: s.risks.filter((r) => r.severity !== 'info') }))
    .filter((x) => x.flags.length > 0);

  if (repoFlags.length === 0) {
    return { text: chalk.green('Guard passed: no warnings or errors across registered repos.'), hasErrors: false, hasWarnings: false };
  }

  for (const { state, flags } of repoFlags) {
    lines.push(`${chalk.cyan(state.entry.name)}  ${chalk.dim(state.entry.path)}`);
    for (const f of flags) {
      if (f.severity === 'error') hasErrors = true;
      if (f.severity === 'warn') hasWarnings = true;
      const colour = severityColor(f.severity);
      lines.push(`  ${colour(`[${severityIcon(f.severity)}] ${f.code}`)}  ${f.message}`);
    }
    lines.push('');
  }

  const summary = hasErrors
    ? chalk.red.bold('Guard FAILED: errors present.')
    : hasWarnings
      ? chalk.yellow('Guard WARNING: warnings present.')
      : chalk.green('Guard passed.');
  lines.push(summary);

  return { text: lines.join('\n'), hasErrors, hasWarnings };
}

export function formatMap(states: RepoState[], relations: Relation[]): string {
  const lines: string[] = [chalk.bold('Repository Map'), ''];

  for (const s of states) {
    const tags: string[] = [];
    tags.push(chalk.dim(s.entry.category));
    if (s.packageInfo?.name) tags.push(chalk.dim(s.packageInfo.name));
    if (s.entry.deploymentEnv) tags.push(chalk.magenta(`deploy: ${s.entry.deploymentEnv}`));
    if (s.entry.requiresExtraCaution) tags.push(chalk.red('caution'));
    lines.push(`${chalk.cyan(s.entry.name)}  ${tags.join('  ')}`);
  }

  if (relations.length > 0) {
    lines.push('');
    lines.push(chalk.bold('Inferred relationships (from package.json):'));
    for (const r of relations) {
      lines.push(`  ${chalk.cyan(r.from)} ${chalk.dim('-> depends-on ->')} ${chalk.cyan(r.to)}`);
    }
  } else {
    lines.push('');
    lines.push(chalk.dim('No package.json relationships inferred.'));
  }

  return lines.join('\n');
}

export function formatRepoDetail(state: RepoState): string {
  const lines: string[] = [];
  lines.push(chalk.bold(state.entry.name) + chalk.dim(`   ${state.entry.path}`));
  lines.push('');

  lines.push(`${chalk.bold('Category:')}  ${state.entry.category}`);
  if (state.entry.packageName) lines.push(`${chalk.bold('Package:')}   ${state.entry.packageName}`);
  if (state.entry.defaultBranch) lines.push(`${chalk.bold('Default branch:')} ${state.entry.defaultBranch}`);
  if (state.entry.protectedBranches?.length) lines.push(`${chalk.bold('Protected:')} ${state.entry.protectedBranches.join(', ')}`);
  if (state.entry.deploymentEnv) lines.push(`${chalk.bold('Deployment:')} ${state.entry.deploymentEnv}`);
  if (state.entry.owner) lines.push(`${chalk.bold('Owner:')}     ${state.entry.owner}`);
  if (state.entry.related?.length) lines.push(`${chalk.bold('Related:')}   ${state.entry.related.join(', ')}`);
  if (state.entry.notes) lines.push(`${chalk.bold('Notes:')}     ${state.entry.notes}`);
  lines.push('');

  if (!state.exists) {
    lines.push(chalk.red('Repository path does not exist.'));
    return lines.join('\n');
  }
  if (!state.isGitRepo) {
    lines.push(chalk.red('Path exists but is not a git repository.'));
    return lines.join('\n');
  }

  const st = state.status!;
  lines.push(chalk.bold('Git'));
  lines.push(`  branch:    ${st.branch ?? '?'}${st.detached ? chalk.yellow(' (detached)') : ''}`);
  lines.push(`  upstream:  ${st.upstream ?? chalk.dim('(none)')}`);
  lines.push(`  remote:    ${st.remoteOriginUrl ?? chalk.dim('(no origin)')}`);
  if (st.aheadCount !== null && st.behindCount !== null) {
    lines.push(`  sync:      ahead=${st.aheadCount}  behind=${st.behindCount}`);
  }
  if (st.head) {
    const date = new Date(st.head.timestamp * 1000).toISOString();
    lines.push(`  head:      ${st.head.hash.slice(0, 12)}  ${date}`);
    lines.push(`             ${st.head.subject}`);
  }
  lines.push(`  dirty:     ${st.dirty ? chalk.yellow('yes') : chalk.green('no')}`);
  if (st.staged.length > 0) lines.push(`  staged:    ${st.staged.length} file(s)`);
  if (st.unstaged.length > 0) lines.push(`  unstaged:  ${st.unstaged.length} file(s)`);
  if (st.untracked.length > 0) lines.push(`  untracked: ${st.untracked.length} file(s)`);
  lines.push('');

  if (state.packageInfo) {
    lines.push(chalk.bold('Package'));
    const p = state.packageInfo;
    lines.push(`  manager:   ${p.manager}`);
    lines.push(`  name:      ${p.name ?? chalk.dim('(none)')}`);
    lines.push(`  version:   ${p.version ?? chalk.dim('(none)')}`);
    lines.push(`  private:   ${p.private ? 'yes' : 'no'}`);
    const ks = keyScripts(p);
    if (Object.keys(ks).length > 0) {
      lines.push('  scripts:');
      for (const [k, v] of Object.entries(ks)) {
        const truncated = v.length > 80 ? v.slice(0, 77) + '...' : v;
        lines.push(`    ${chalk.cyan(k.padEnd(10))} ${chalk.dim(truncated)}`);
      }
    }
    lines.push('');
  }

  lines.push(chalk.bold('Other'));
  lines.push(`  CLAUDE.md: ${state.hasClaudeMd ? chalk.green('present') : chalk.yellow('missing')}`);
  lines.push('');

  if (state.risks.length > 0) {
    lines.push(chalk.bold('Risks'));
    for (const r of state.risks) {
      const colour = severityColor(r.severity);
      lines.push(`  ${colour(`[${severityIcon(r.severity)}] ${r.code}`)}  ${r.message}`);
    }
  } else {
    lines.push(chalk.green('No risks flagged.'));
  }

  return lines.join('\n');
}

export function formatSummary(states: RepoState[]): string {
  const lines: string[] = [];
  for (const s of states) {
    const st = s.status;
    const branch = st?.branch ?? '?';
    const dirty = st?.dirty ? 'dirty' : 'clean';
    const ab = st && st.aheadCount !== null && st.behindCount !== null
      ? `+${st.aheadCount}/-${st.behindCount}`
      : '-';
    const v = s.packageInfo?.version ? `v${s.packageInfo.version}` : '-';
    const flags = summariseRisks(s.risks);
    const riskTag = flags.errors > 0 ? `E${flags.errors}` : flags.warnings > 0 ? `W${flags.warnings}` : 'ok';
    lines.push(`${s.entry.name}\t${branch}\t${dirty}\t${ab}\t${v}\t${riskTag}`);
  }
  return lines.join('\n');
}

export function formatPlan(
  states: RepoState[],
  order: string[],
  cycles: string[][],
): string {
  const lines: string[] = [chalk.bold('Suggested Multi-Repo Execution Order'), ''];

  const dirtyByName = new Map<string, RepoState>();
  for (const s of states) {
    if (s.status?.dirty) dirtyByName.set(s.entry.name, s);
  }

  if (dirtyByName.size > 0) {
    lines.push(chalk.yellow('Note: dirty working trees detected. Stash or commit before sequencing changes.'));
    for (const [name, s] of dirtyByName) {
      lines.push(`  ${chalk.yellow('!')} ${chalk.cyan(name)}  ${chalk.dim(s.entry.path)}`);
    }
    lines.push('');
  }

  for (let i = 0; i < order.length; i += 1) {
    const name = order[i];
    if (!name) continue;
    const s = states.find((x) => x.entry.name === name);
    const tag = s?.entry.requiresExtraCaution ? chalk.red(' [caution]') : '';
    lines.push(`  ${String(i + 1).padStart(2, ' ')}. ${chalk.cyan(name)}${tag}`);
  }

  if (cycles.length > 0) {
    lines.push('');
    lines.push(chalk.red('Cycles detected (review and break before automating):'));
    for (const c of cycles) {
      lines.push(`  ${c.join(' -> ')}`);
    }
  }

  return lines.join('\n');
}
