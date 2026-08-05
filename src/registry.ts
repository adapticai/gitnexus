/**
 * Registry loader and auto-discovery fallback.
 *
 * Priority:
 *   1. Explicit --config path passed by the caller
 *   2. Walk up from the current directory looking for `gitnexus.config.json`
 *   3. Auto-discover sibling git repos under a configured discoveryRoot
 *
 * On a missing/empty registry we fall back to discovery only. On a malformed
 * file we throw — bad config is an error, not a warning.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { RegistryEntry, RegistryFile, ResolvedRegistry } from './types.js';

export const REGISTRY_FILE_NAME = 'gitnexus.config.json';

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

/**
 * Walk up from `start` looking for the registry file. Returns the absolute
 * path to the file or null if not found before the filesystem root.
 */
export function findRegistryFile(start: string): string | null {
  let current = resolve(start);
  // Hard cap to prevent runaway in pathological filesystems.
  for (let i = 0; i < 64; i += 1) {
    const candidate = join(current, REGISTRY_FILE_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

/**
 * Registry schema versions this build can load.
 *
 * v2 (2026-08) is PURELY ADDITIVE over v1: it introduces the top-level
 * `schemaUrl` / `metaRepo` / `topicIndex` keys and the per-repo `owner`,
 * `purpose`, `runtime`, `claudeMd`, `entrypoints`, `topics`, `related` and
 * `requiresExtraCaution` metadata. `parseEntry` reads only the fields it knows
 * and ignores the rest, so a v2 file yields an identical `RegistryEntry` set.
 *
 * Accepting both matters operationally: `gitnexus.config.json` was bumped to
 * v2 while the loader still hard-required 1, so EVERY command — including
 * `gitnexus guard`, the documented pre-push safety check — aborted with exit 2
 * and validated nothing.
 */
const SUPPORTED_REGISTRY_VERSIONS: ReadonlySet<number> = new Set([1, 2]);

interface RawRegistryFile {
  version?: unknown;
  discoveryRoot?: unknown;
  repos?: unknown;
}

interface RawEntry {
  name?: unknown;
  path?: unknown;
  category?: unknown;
  packageName?: unknown;
  defaultBranch?: unknown;
  protectedBranches?: unknown;
  deploymentEnv?: unknown;
  related?: unknown;
  owner?: unknown;
  allowAgentEdits?: unknown;
  requiresExtraCaution?: unknown;
  notes?: unknown;
}

const VALID_CATEGORIES = new Set([
  'engine',
  'frontend',
  'backend',
  'package',
  'infra',
  'agent',
  'docs',
  'meta',
  'other',
]);

function parseStringArray(value: unknown, field: string, repoLabel: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new RegistryError(`Repo "${repoLabel}": "${field}" must be a string array.`);
  }
  for (const v of value) {
    if (typeof v !== 'string') {
      throw new RegistryError(`Repo "${repoLabel}": "${field}" must contain only strings.`);
    }
  }
  return value as string[];
}

function parseEntry(raw: RawEntry, registryDir: string, idx: number): RegistryEntry {
  const label = typeof raw.name === 'string' ? raw.name : `#${idx}`;
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    throw new RegistryError(`Repo ${label}: "name" must be a non-empty string.`);
  }
  if (typeof raw.path !== 'string' || raw.path.trim() === '') {
    throw new RegistryError(`Repo "${raw.name}": "path" must be a non-empty string.`);
  }
  if (typeof raw.category !== 'string' || !VALID_CATEGORIES.has(raw.category)) {
    throw new RegistryError(
      `Repo "${raw.name}": "category" must be one of ${[...VALID_CATEGORIES].join(', ')}.`,
    );
  }

  const path = isAbsolute(raw.path) ? raw.path : resolve(registryDir, raw.path);

  const entry: RegistryEntry = {
    name: raw.name,
    path,
    category: raw.category as RegistryEntry['category'],
  };

  if (raw.packageName !== undefined) {
    if (typeof raw.packageName !== 'string') {
      throw new RegistryError(`Repo "${raw.name}": "packageName" must be a string.`);
    }
    entry.packageName = raw.packageName;
  }
  if (raw.defaultBranch !== undefined) {
    if (typeof raw.defaultBranch !== 'string') {
      throw new RegistryError(`Repo "${raw.name}": "defaultBranch" must be a string.`);
    }
    entry.defaultBranch = raw.defaultBranch;
  }
  const protectedBranches = parseStringArray(raw.protectedBranches, 'protectedBranches', raw.name);
  if (protectedBranches) entry.protectedBranches = protectedBranches;
  if (raw.deploymentEnv !== undefined) {
    if (typeof raw.deploymentEnv !== 'string') {
      throw new RegistryError(`Repo "${raw.name}": "deploymentEnv" must be a string.`);
    }
    entry.deploymentEnv = raw.deploymentEnv;
  }
  const related = parseStringArray(raw.related, 'related', raw.name);
  if (related) entry.related = related;
  if (raw.owner !== undefined) {
    if (typeof raw.owner !== 'string') {
      throw new RegistryError(`Repo "${raw.name}": "owner" must be a string.`);
    }
    entry.owner = raw.owner;
  }
  if (raw.allowAgentEdits !== undefined) {
    if (typeof raw.allowAgentEdits !== 'boolean') {
      throw new RegistryError(`Repo "${raw.name}": "allowAgentEdits" must be a boolean.`);
    }
    entry.allowAgentEdits = raw.allowAgentEdits;
  }
  if (raw.requiresExtraCaution !== undefined) {
    if (typeof raw.requiresExtraCaution !== 'boolean') {
      throw new RegistryError(`Repo "${raw.name}": "requiresExtraCaution" must be a boolean.`);
    }
    entry.requiresExtraCaution = raw.requiresExtraCaution;
  }
  if (raw.notes !== undefined) {
    if (typeof raw.notes !== 'string') {
      throw new RegistryError(`Repo "${raw.name}": "notes" must be a string.`);
    }
    entry.notes = raw.notes;
  }
  return entry;
}

export interface ParsedRegistry {
  file: RegistryFile;
  registryPath: string;
  registryDir: string;
}

export function loadRegistry(registryPath: string): ParsedRegistry {
  if (!existsSync(registryPath)) {
    throw new RegistryError(`Registry file not found: ${registryPath}`);
  }
  let raw: RawRegistryFile;
  try {
    raw = JSON.parse(readFileSync(registryPath, 'utf8')) as RawRegistryFile;
  } catch (err) {
    throw new RegistryError(`Failed to parse ${registryPath}: ${(err as Error).message}`);
  }
  if (typeof raw.version !== 'number' || !SUPPORTED_REGISTRY_VERSIONS.has(raw.version)) {
    throw new RegistryError(
      `Unsupported registry version: ${String(raw.version)}. Expected one of ${[...SUPPORTED_REGISTRY_VERSIONS].join(', ')}.`,
    );
  }
  if (!Array.isArray(raw.repos)) {
    throw new RegistryError(`Registry "repos" must be an array.`);
  }
  const registryDir = dirname(registryPath);
  const repos: RegistryEntry[] = (raw.repos as RawEntry[]).map((r, i) => parseEntry(r, registryDir, i));

  const seen = new Set<string>();
  for (const r of repos) {
    if (seen.has(r.name)) {
      throw new RegistryError(`Duplicate repo name: "${r.name}"`);
    }
    seen.add(r.name);
  }

  let discoveryRoot: string | undefined;
  if (raw.discoveryRoot !== undefined) {
    if (typeof raw.discoveryRoot !== 'string') {
      throw new RegistryError(`"discoveryRoot" must be a string.`);
    }
    discoveryRoot = isAbsolute(raw.discoveryRoot)
      ? raw.discoveryRoot
      : resolve(registryDir, raw.discoveryRoot);
  }

  const file: RegistryFile = { version: 1, repos };
  if (discoveryRoot) file.discoveryRoot = discoveryRoot;

  return { file, registryPath, registryDir };
}

/**
 * Discover candidate repos under `rootDir` by scanning direct children for
 * `.git/` directories. Returns synthetic registry entries.
 */
export function discoverRepos(rootDir: string): RegistryEntry[] {
  if (!existsSync(rootDir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(rootDir);
  } catch {
    return [];
  }
  const out: RegistryEntry[] = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const fullPath = join(rootDir, name);
    let s;
    try {
      s = statSync(fullPath);
    } catch {
      continue;
    }
    if (!s.isDirectory()) continue;
    if (!existsSync(join(fullPath, '.git'))) continue;
    out.push({
      name,
      path: fullPath,
      category: 'other',
      allowAgentEdits: true,
      notes: 'auto-discovered',
    });
  }
  return out;
}

export interface ResolveOptions {
  /** Caller-supplied explicit registry path. Takes precedence. */
  configPath?: string;
  /** Where to start the upward search for the registry file. */
  searchFrom?: string;
  /** Override discovery root (default: registry's directory or searchFrom). */
  discoveryRoot?: string;
  /** Disable the file-based registry, use discovery only. */
  discoveryOnly?: boolean;
}

export function resolveRegistry(opts: ResolveOptions = {}): ResolvedRegistry {
  const searchFrom = opts.searchFrom ?? process.cwd();

  if (opts.discoveryOnly) {
    const root = opts.discoveryRoot ?? searchFrom;
    return { source: 'discovery', entries: discoverRepos(root) };
  }

  const explicit = opts.configPath;
  if (explicit) {
    const parsed = loadRegistry(explicit);
    return { source: 'file', registryPath: parsed.registryPath, entries: parsed.file.repos };
  }

  const found = findRegistryFile(searchFrom);
  if (found) {
    const parsed = loadRegistry(found);
    return { source: 'file', registryPath: parsed.registryPath, entries: parsed.file.repos };
  }

  const root = opts.discoveryRoot ?? searchFrom;
  return { source: 'discovery', entries: discoverRepos(root) };
}
