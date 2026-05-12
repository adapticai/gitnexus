/**
 * Programmatic API for GitNexus.
 *
 * Importable by other tools that want repo state without shelling out to the CLI.
 */

export { inspectRepo, inspectAll } from './inspect.js';
export {
  loadRegistry,
  resolveRegistry,
  discoverRepos,
  findRegistryFile,
  REGISTRY_FILE_NAME,
  RegistryError,
} from './registry.js';
export type { ParsedRegistry, ResolveOptions } from './registry.js';
export { evaluateRisks, summariseRisks } from './risks.js';
export { inferRelations, topologicalOrder } from './relations.js';
export {
  readGitStatus,
  isGitRepo,
  readBranch,
  readUpstream,
  readRemoteOrigin,
  readHeadCommit,
  readAheadBehind,
  parsePorcelain,
} from './git.js';
export { readPackageInfo, detectPackageManager, keyScripts } from './package-info.js';
export { EXIT } from './exit-codes.js';
export type {
  RepoCategory,
  RegistryEntry,
  RegistryFile,
  ResolvedRegistry,
  CommitInfo,
  GitStatus,
  PackageManager,
  PackageInfo,
  RiskSeverity,
  RiskCode,
  RiskFlag,
  RepoState,
  Relation,
  CommandResult,
  CliOptions,
} from './types.js';
