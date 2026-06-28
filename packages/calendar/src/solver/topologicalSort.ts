import type { SolverDependency } from './types.js';

/**
 * Sorts event ids in topological order using Kahn's BFS algorithm.
 * Disabled dependencies are excluded from the sort.
 *
 * @throws {Error} With message `'CYCLE_DETECTED'` when the dependency graph contains a cycle
 * @returns Event ids ordered such that every predecessor appears before its successors
 */
export function topologicalSort(
  eventIds: string[],
  dependencies: SolverDependency[],
): string[] {
  const activeDeps = dependencies.filter(d => !d.isDisabled);

  const inDegree  = new Map<string, number>();
  const successors = new Map<string, string[]>();

  for (const id of eventIds) {
    inDegree.set(id, 0);
    successors.set(id, []);
  }

  for (const dep of activeDeps) {
    inDegree.set(dep.successorId, (inDegree.get(dep.successorId) ?? 0) + 1);
    const succs = successors.get(dep.predecessorId) ?? [];
    succs.push(dep.successorId);
    successors.set(dep.predecessorId, succs);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const succ of successors.get(node) ?? []) {
      const newDeg = (inDegree.get(succ) ?? 1) - 1;
      inDegree.set(succ, newDeg);
      if (newDeg === 0) queue.push(succ);
    }
  }

  if (sorted.length !== eventIds.length) {
    throw new Error('CYCLE_DETECTED');
  }

  return sorted;
}
