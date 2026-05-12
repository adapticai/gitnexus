/**
 * Risk evaluation rules for repo state.
 *
 * Each rule produces zero or one RiskFlag. Severity ladder:
 *   - error: must block automation (missing repo, not a git repo)
 *   - warn:  proceed with caution (dirty tree, wrong branch, no upstream, etc.)
 *   - info:  surface as context (missing CLAUDE.md, private package)
 */

import type {
  GitStatus,
  PackageInfo,
  RegistryEntry,
  RiskFlag,
} from './types.js';

export interface RiskInput {
  entry: RegistryEntry;
  exists: boolean;
  isGitRepo: boolean;
  status: GitStatus | null;
  packageInfo: PackageInfo | null;
  hasClaudeMd: boolean;
}

export function evaluateRisks(input: RiskInput): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const { entry, exists, isGitRepo, status, packageInfo, hasClaudeMd } = input;

  if (!exists) {
    flags.push({
      severity: 'error',
      code: 'MISSING_REPO',
      message: `Path does not exist: ${entry.path}`,
    });
    return flags;
  }
  if (!isGitRepo) {
    flags.push({
      severity: 'error',
      code: 'NOT_GIT_REPO',
      message: `Path is not a git repository: ${entry.path}`,
    });
    return flags;
  }
  if (!status) {
    // Should not happen if isGitRepo is true, but guard defensively.
    return flags;
  }

  // DIRTY_TREE = tracked-file modifications (staged or unstaged).
  // UNTRACKED_FILES = untracked files present.
  // Both can fire independently so the agent sees the full picture.
  const hasTrackedChanges = status.staged.length > 0 || status.unstaged.length > 0;
  if (hasTrackedChanges) {
    flags.push({
      severity: 'warn',
      code: 'DIRTY_TREE',
      message: `Tracked files changed (staged=${status.staged.length} unstaged=${status.unstaged.length}).`,
    });
  }
  if (status.untracked.length > 0) {
    flags.push({
      severity: 'warn',
      code: 'UNTRACKED_FILES',
      message: `${status.untracked.length} untracked file(s) present.`,
    });
  }

  if (entry.defaultBranch && status.branch && status.branch !== entry.defaultBranch && !status.detached) {
    flags.push({
      severity: 'warn',
      code: 'WRONG_BRANCH',
      message: `On branch "${status.branch}", expected default "${entry.defaultBranch}".`,
    });
  }

  if (
    entry.protectedBranches &&
    status.branch &&
    entry.protectedBranches.includes(status.branch) &&
    entry.allowAgentEdits === false
  ) {
    flags.push({
      severity: 'warn',
      code: 'PROTECTED_BRANCH',
      message: `Currently on protected branch "${status.branch}"; agent edits disabled by registry.`,
    });
  }

  if (status.detached) {
    flags.push({
      severity: 'warn',
      code: 'DETACHED_HEAD',
      message: 'HEAD is detached.',
    });
  }

  if (!status.hasRemote) {
    flags.push({
      severity: 'warn',
      code: 'NO_REMOTE',
      message: 'No "origin" remote configured.',
    });
  } else if (!status.upstream && !status.detached) {
    flags.push({
      severity: 'warn',
      code: 'NO_UPSTREAM',
      message: `Branch "${status.branch ?? '?'}" has no upstream tracking branch.`,
    });
  }

  if (status.aheadCount !== null && status.behindCount !== null) {
    if (status.aheadCount > 0 || status.behindCount > 0) {
      flags.push({
        severity: 'warn',
        code: 'AHEAD_BEHIND',
        message: `Diverged from upstream (ahead=${status.aheadCount}, behind=${status.behindCount}).`,
      });
    }
  }

  if (!hasClaudeMd) {
    flags.push({
      severity: 'info',
      code: 'NO_CLAUDE_MD',
      message: 'No CLAUDE.md found at repo root.',
    });
  }

  if (packageInfo?.private) {
    flags.push({
      severity: 'info',
      code: 'PRIVATE_PACKAGE',
      message: `Private package${packageInfo.name ? ` (${packageInfo.name})` : ''}.`,
    });
  }

  return flags;
}

export function summariseRisks(flags: RiskFlag[]): { errors: number; warnings: number; infos: number } {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const f of flags) {
    if (f.severity === 'error') errors += 1;
    else if (f.severity === 'warn') warnings += 1;
    else infos += 1;
  }
  return { errors, warnings, infos };
}
