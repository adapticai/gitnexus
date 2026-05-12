/**
 * Infer cross-repo relationships from package.json dependencies.
 *
 * Always marks results as `inferred: true` so the source is explicit.
 */

import type { Relation, RepoState } from './types.js';

export function inferRelations(states: readonly RepoState[]): Relation[] {
  const byPackageName = new Map<string, string>();
  for (const s of states) {
    const pkgName = s.packageInfo?.name;
    if (pkgName) byPackageName.set(pkgName, s.entry.name);
  }

  const relations: Relation[] = [];
  for (const s of states) {
    const pkg = s.packageInfo;
    if (!pkg) continue;
    const allDeps: Record<string, string> = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };
    for (const depName of Object.keys(allDeps)) {
      const targetRepo = byPackageName.get(depName);
      if (targetRepo && targetRepo !== s.entry.name) {
        relations.push({
          from: s.entry.name,
          to: targetRepo,
          kind: 'depends-on',
          via: 'package.json',
          inferred: true,
        });
      }
    }
  }

  return relations;
}

/**
 * Topological sort for execution sequencing. Returns repo names ordered such
 * that dependencies come before dependents. Cycles are surfaced via the
 * `cycles` field rather than thrown.
 */
export function topologicalOrder(
  states: readonly RepoState[],
  relations: readonly Relation[],
): { order: string[]; cycles: string[][] } {
  const nodes = new Set(states.map((s) => s.entry.name));
  const adjacency = new Map<string, Set<string>>();
  for (const n of nodes) adjacency.set(n, new Set());
  for (const r of relations) {
    // edge: dep -> dependent (so deps appear first in topo order)
    if (nodes.has(r.to) && nodes.has(r.from)) {
      adjacency.get(r.to)?.add(r.from);
    }
  }

  const visited = new Set<string>();
  const stack = new Set<string>();
  const order: string[] = [];
  const cycles: string[][] = [];
  const path: string[] = [];

  function visit(n: string): void {
    if (visited.has(n)) return;
    if (stack.has(n)) {
      const start = path.indexOf(n);
      cycles.push(path.slice(start).concat(n));
      return;
    }
    stack.add(n);
    path.push(n);
    const next = adjacency.get(n);
    if (next) {
      // deterministic order
      const sorted = [...next].sort();
      for (const m of sorted) visit(m);
    }
    stack.delete(n);
    path.pop();
    visited.add(n);
    order.push(n);
  }

  // Seed from nodes with no incoming edges first for determinism, then any remaining.
  const incoming = new Map<string, number>();
  for (const n of nodes) incoming.set(n, 0);
  for (const [, outs] of adjacency) {
    for (const t of outs) incoming.set(t, (incoming.get(t) ?? 0) + 1);
  }
  const seeds = [...nodes].filter((n) => (incoming.get(n) ?? 0) === 0).sort();
  for (const seed of seeds) visit(seed);
  for (const n of [...nodes].sort()) visit(n);

  return { order: order.reverse(), cycles };
}
