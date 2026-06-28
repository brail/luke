import type { GraphInput, SolverDependency, SolverEvent } from './types.js';

/**
 * Pre-processed graph structure produced by `buildGraph`.
 * Provides O(1) lookup for events and adjacency lists for both directions of traversal.
 */
export interface BuiltGraph {
  eventMap:       Map<string, SolverEvent>;
  activeDeps:     SolverDependency[];
  predecessorsOf: Map<string, SolverDependency[]>;
  successorsOf:   Map<string, SolverDependency[]>;
}

/**
 * Builds an adjacency-list graph from the solver input.
 * Disabled dependencies are excluded from `activeDeps` and the adjacency maps.
 *
 * @returns `BuiltGraph` with event lookup map and predecessor/successor adjacency lists
 */
export function buildGraph(input: GraphInput): BuiltGraph {
  const eventMap = new Map(input.events.map(e => [e.id, e]));
  const activeDeps = input.dependencies.filter(d => !d.isDisabled);

  const predecessorsOf = new Map<string, SolverDependency[]>();
  const successorsOf   = new Map<string, SolverDependency[]>();

  for (const dep of activeDeps) {
    const preds = predecessorsOf.get(dep.successorId) ?? [];
    preds.push(dep);
    predecessorsOf.set(dep.successorId, preds);

    const succs = successorsOf.get(dep.predecessorId) ?? [];
    succs.push(dep);
    successorsOf.set(dep.predecessorId, succs);
  }

  return { eventMap, activeDeps, predecessorsOf, successorsOf };
}
