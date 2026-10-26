declare function work(): Promise<void>;
declare function toErrorMessage(err: unknown): string;
declare const logger: { error(obj: object, msg: string): void };

export async function storedByHand() {
  try {
    await work();
  } catch (error) {
    // ruleid: luke-error-message-by-hand
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function interpolatedByHand() {
  try {
    await work();
  } catch (err) {
    // ruleid: luke-error-message-by-hand
    throw new Error(`Upload failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

export async function negatedByHand() {
  try {
    await work();
  } catch (err) {
    // ruleid: luke-error-message-by-hand
    return !(err instanceof Error) ? String(err) : err.message;
  }
}

export async function castByHand() {
  try {
    await work();
  } catch (err) {
    // ruleid: luke-error-message-by-hand
    return (err as Error).message;
  }
}

export async function stored() {
  try {
    await work();
  } catch (error) {
    // ok: luke-error-message-by-hand
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function logged() {
  try {
    await work();
  } catch (err) {
    // ok: luke-error-message-by-hand
    logger.error({ err }, 'work failed');
  }
}

export function stackOnly(err: unknown) {
  // ok: luke-error-message-by-hand
  return err instanceof Error ? err.stack : undefined;
}
