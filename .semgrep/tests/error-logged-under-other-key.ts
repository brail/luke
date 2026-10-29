declare function work(): Promise<void>;
declare function toErrorMessage(err: unknown): string;
declare const log: { warn(obj: object, msg?: string): void; error(obj: object, msg?: string): void };
declare const ctx: { logger?: { warn(obj: object, msg?: string): void } };

export async function underErrorKey() {
  try {
    await work();
  } catch (error) {
    // ruleid: luke-error-logged-under-other-key
    log.error({ error }, 'failed');
  }
}

export async function underNamedKey() {
  try {
    await work();
  } catch (e) {
    // ruleid: luke-error-logged-under-other-key
    log.warn({ error: e, rowId: 1 }, 'failed');
  }
}

export async function shorthandOptionalChain() {
  try {
    await work();
  } catch (auditError) {
    // ruleid: luke-error-logged-under-other-key
    ctx.logger?.warn({ auditError }, 'audit failed');
  }
}

export function inCatchCallback() {
  // ruleid: luke-error-logged-under-other-key
  return work().catch(e => log.warn({ e }, 'failed'));
}

export function inTypedExpressionCallback() {
  // ruleid: luke-error-logged-under-other-key
  return work().catch((reason: unknown) => log.warn({ reason }, 'failed'));
}

export function inTypedCatchCallback() {
  return work().catch((reason: unknown) => {
    // ruleid: luke-error-logged-under-other-key
    log.error({ reason }, 'failed');
  });
}

export async function withFinally(release: () => void) {
  try {
    await work();
  } catch (e) {
    // ruleid: luke-error-logged-under-other-key
    log.error({ error: e }, 'failed');
  } finally {
    release();
  }
}

export function asRejectionHandler() {
  // ruleid: luke-error-logged-under-other-key
  return work().then(undefined, e => log.warn({ e }, 'failed'));
}

export async function wholeUnderErr() {
  try {
    await work();
  } catch (e) {
    // ok: luke-error-logged-under-other-key
    log.error({ err: e, rowId: 1 }, 'failed');
  }
}

export async function messageUnderError() {
  try {
    await work();
  } catch (e) {
    // ok: luke-error-logged-under-other-key
    log.warn({ error: toErrorMessage(e) }, 'refused');
  }
}

export async function anotherValue(rowId: string) {
  try {
    await work();
  } catch (e) {
    // ok: luke-error-logged-under-other-key
    log.warn({ err: e, error: rowId }, 'failed');
  }
}
