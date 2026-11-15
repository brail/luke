declare function work(): Promise<void>;
declare function toErrorMessage(err: unknown): string;
declare function externalCheckFailed(message: string): Error;
declare const logger: { warn(obj: object, msg: string): void };
declare class TRPCError extends Error {
  constructor(opts: { code: string; message: string; cause?: unknown });
}

export async function providerTextInMessage() {
  try {
    await work();
  } catch (err) {
    // ruleid: luke-provider-text-to-client
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `S3 failed: ${toErrorMessage(err)}`, cause: err });
  }
}

export async function providerMessageInMessage() {
  try {
    await work();
  } catch (err) {
    const error = err as Error; // Fixture: only the shape the rule matches.
    // ruleid: luke-provider-text-to-client
    throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
  }
}

export async function providerTextReturned() {
  try {
    await work();
    return { ok: true };
  } catch (err) {
    // ruleid: luke-provider-text-to-client
    return { ok: false, error: toErrorMessage(err) };
  }
}

export async function fixedTextLogged() {
  try {
    await work();
    return { ok: true };
  } catch (err) {
    logger.warn({ err }, 'test failed');
    // ok: luke-provider-text-to-client
    throw externalCheckFailed('Test fallito: verifica endpoint e credenziali');
  }
}

export function fixedTextReturned() {
  // ok: luke-provider-text-to-client
  return { ok: false, error: 'Dominio non configurato' };
}
