/**
 * An in-process queue: operations submitted to it run one at a time, in submission order, each
 * starting only once the previous one has settled. A failed operation rejects its own caller and
 * does not stop the next. In-process is enough because the API runs as one process (ADR-011).
 */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      const result = tail.then(operation, operation);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
