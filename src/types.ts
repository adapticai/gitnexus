/**
 * Public types shared across GitNexus.
 *
 * Keep this file dependency-free so it can be imported by anything.
 */

export type RepoCategory =
  | 'engine'
  | 'frontend'
  | 'backend'
  | 'package'
  | 'infra'
  | 'agent'
  | 'docs'
  | 'meta'
  | 'other';

export interface RegistryEntry {
  /** Short, kebab-case identifier used in CLI output and inter-repo references. */
  name: string;
  /** Absolute path to the repository working tree. */
  path: string;
  /** What kind of repo this is. Drives default risk evaluation. */
  category: RepoCategory;
  /** NPM package name if the repo publishes one. */
  packageName?: string;
  /** Branch the repo lives on by default (e.g. "main", "master"). */
  defaultBranch?: string;
  /**
   * Branches that should not be modified by automation without explicit
   * authorisation (e.g. "main", "stable").
   */
  protectedBranches?: string[];
  /** Free-form note about deployment binding (e.g. "Railway adaptic-os/stable"). */
  deploymentEnv?: string;
  /** Names of related repos for context (e.g. "engine -> utils, backend-legacy"). */
  related?: string[];
  /** Human owner / domain steward (purely informational). */
  owner?: string;
  /**
   * Whether agents may modify this repo by default. False = guard rails up.
   * Defaults to true if omitted.
   */
  allowAgentEdits?: boolean;
  /** Marks repo as deployment-linked or otherwise high-blast-radius. */
  requiresExtraCaution?: boolean;
  /** Free-form notes surfaced in detailed views. */
  notes?: string;
}

export interface RegistryFile {
  /** Schema version. Currently always 1. */
  version: 1;
  /** Optional default root for auto-discovery fallback (defaults to file's directory). */
  discoveryRoot?: string;
  /** Registered repositories. */
  repos: RegistryEntry[];
}

export interface ResolvedRegistry {
  source: 'file' | 'discovery' | 'mixed';
  registryPath?: string;
  entries: RegistryEntry[];
}

export interface CommitInfo {
  hash: string;
  /** Unix epoch seconds. */
  timestamp: number;
  /** First line of the commit message. */
  subject: string;
}

export interface GitStatus {
  branch: string | null;
  upstream: string | null;
  remoteOriginUrl: string | null;
  hasRemote: boolean;
  detached: boolean;
  dirty: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  aheadCount: number | null;
  behindCount: number | null;
  head: CommitInfo | null;
}

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'unknown';

export interface PackageInfo {
  manager: PackageManager;
  name: string | null;
  version: string | null;
  private: boolean;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
}

export type RiskSeverity = 'info' | 'warn' | 'error';

export type RiskCode =
  | 'MISSING_REPO'
  | 'NOT_GIT_REPO'
  | 'DIRTY_TREE'
  | 'UNTRACKED_FILES'
  | 'WRONG_BRANCH'
  | 'PROTECTED_BRANCH'
  | 'NO_UPSTREAM'
  | 'DETACHED_HEAD'
  | 'AHEAD_BEHIND'
  | 'NO_REMOTE'
  | 'NO_CLAUDE_MD'
  | 'PRIVATE_PACKAGE';

export interface RiskFlag {
  severity: RiskSeverity;
  code: RiskCode;
  message: string;
}

export interface RepoState {
  entry: RegistryEntry;
  exists: boolean;
  isGitRepo: boolean;
  hasClaudeMd: boolean;
  status: GitStatus | null;
  packageInfo: PackageInfo | null;
  risks: RiskFlag[];
}

export interface Relation {
  from: string;
  to: string;
  kind: 'depends-on';
  via: 'package.json';
  inferred: true;
}

export interface CommandResult {
  exitCode: number;
  output: string;
}

export interface CliOptions {
  json: boolean;
  noColor: boolean;
  configPath?: string;
  strict: boolean;
}
