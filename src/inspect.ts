/**
 * Compose all per-repo readers into a single RepoState.
 *
 * Pure orchestration; safe and read-only.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isGitRepo, pathExists, readGitStatus } from './git.js';
import { readPackageInfo } from './package-info.js';
import { evaluateRisks } from './risks.js';
import type { RegistryEntry, RepoState } from './types.js';

export function inspectRepo(entry: RegistryEntry): RepoState {
  const exists = pathExists(entry.path);
  const gitRepo = exists && isGitRepo(entry.path);
  const status = gitRepo ? readGitStatus(entry.path) : null;
  const packageInfo = exists ? readPackageInfo(entry.path) : null;
  const hasClaudeMd = exists && existsSync(join(entry.path, 'CLAUDE.md'));

  const risks = evaluateRisks({
    entry,
    exists,
    isGitRepo: gitRepo,
    status,
    packageInfo,
    hasClaudeMd,
  });

  return {
    entry,
    exists,
    isGitRepo: gitRepo,
    hasClaudeMd,
    status,
    packageInfo,
    risks,
  };
}

export function inspectAll(entries: readonly RegistryEntry[]): RepoState[] {
  return entries.map(inspectRepo);
}
