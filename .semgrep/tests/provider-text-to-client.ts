declare function work(): Promise<void>;
declare function toErrorMessage(err: unknown): string;
declare function externalCheckFailed(message: string): Error;
declare const logger: { warn(obj: object, msg: string): void };
declare function cleanup(): void;
declare function s3TestFailureMessage(err: unknown): string;
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

export async function providerMessageThroughAVariable() {
  try {
    await work();
  } catch (err) {
    const text = (err as Error).message; // Fixture: only the shape the rule follows.
    const message = `Restore fallito: ${text}`;
    // ruleid: luke-provider-text-to-client
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message, cause: err });
  }
}

export async function providerMessageWithFinally() {
  try {
    await work();
  } catch (err) {
    // ruleid: luke-provider-text-to-client
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Restore fallito: ${(err as Error).message}`, cause: err });
  } finally {
    cleanup();
  }
}

export async function providerMessageOfAnAlias() {
  try {
    await work();
  } catch (err) {
    const error = err as Error; // Fixture: only the shape the rule follows.
    // ruleid: luke-provider-text-to-client
    throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
  }
}

export async function providerMessageInAPromiseCatch() {
  await work().catch((err: Error) => {
    // ruleid: luke-provider-text-to-client
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Test fallito: ' + err.message });
  });
}

export async function providerTextStringified() {
  try {
    await work();
  } catch (err) {
    // ruleid: luke-provider-text-to-client
    throw new TRPCError({ code: 'BAD_REQUEST', message: String(err) });
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

export async function providerTextPushed(keys: string[]) {
  const results: { key: string; error?: string }[] = [];
  for (const key of keys) {
    try {
      await work();
    } catch (error) {
      // ruleid: luke-provider-text-to-client
      results.push({ key, error: toErrorMessage(error) });
    }
  }
  return results;
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

export async function fixedTextWithCause() {
  try {
    await work();
  } catch (err) {
    // ok: luke-provider-text-to-client
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Restore fallito: il dettaglio è nel log del server', cause: err });
  }
}

export async function textMappedToAFixedOne() {
  try {
    await work();
  } catch (err) {
    // ok: luke-provider-text-to-client
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: s3TestFailureMessage(err) });
  }
}

export function fixedTextReturned() {
  // ok: luke-provider-text-to-client
  return { ok: false, error: 'Dominio non configurato' };
}
