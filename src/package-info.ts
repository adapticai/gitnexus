/**
 * Detect package manager and read package.json for a repository.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PackageInfo, PackageManager } from './types.js';

export function detectPackageManager(repoPath: string): PackageManager {
  if (existsSync(join(repoPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(repoPath, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(repoPath, 'package-lock.json'))) return 'npm';
  if (existsSync(join(repoPath, 'package.json'))) return 'unknown';
  return 'unknown';
}

interface RawPackageJson {
  name?: unknown;
  version?: unknown;
  private?: unknown;
  scripts?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
}

function asStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') result[k] = v;
  }
  return result;
}

export function readPackageInfo(repoPath: string): PackageInfo | null {
  const pkgPath = join(repoPath, 'package.json');
  if (!existsSync(pkgPath)) return null;
  let raw: RawPackageJson;
  try {
    raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as RawPackageJson;
  } catch {
    return null;
  }
  return {
    manager: detectPackageManager(repoPath),
    name: typeof raw.name === 'string' ? raw.name : null,
    version: typeof raw.version === 'string' ? raw.version : null,
    private: raw.private === true,
    scripts: asStringRecord(raw.scripts),
    dependencies: asStringRecord(raw.dependencies),
    devDependencies: asStringRecord(raw.devDependencies),
    peerDependencies: asStringRecord(raw.peerDependencies),
  };
}

/**
 * Pick a few high-signal scripts to surface in summary output.
 */
export function keyScripts(info: PackageInfo | null): Record<string, string> {
  if (!info) return {};
  const wanted = ['build', 'test', 'lint', 'typecheck', 'dev', 'start'];
  const out: Record<string, string> = {};
  for (const name of wanted) {
    const value = info.scripts[name];
    if (value !== undefined) out[name] = value;
  }
  return out;
}
