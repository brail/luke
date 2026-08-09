/**
 * Accumulates positional PostgreSQL parameters (`$1`, `$2`, …) for raw queries,
 * so optional filters can't drift out of sync with their placeholder indexes.
 */
export class PgParams {
  private params: unknown[];

  constructor(base: readonly unknown[] = []) {
    this.params = [...base];
  }

  /** Appends a value and returns its placeholder (e.g. `"$3"`). */
  add(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  /** Values in placeholder order, to spread into `$queryRawUnsafe`. */
  get values(): unknown[] {
    return this.params;
  }
}
