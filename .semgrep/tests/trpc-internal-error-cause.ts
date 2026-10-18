declare class TRPCError extends Error {
  constructor(opts: { code: string; message?: string; cause?: unknown });
}
declare function work(): Promise<void>;

export async function lostCause() {
  try {
    await work();
    // ruleid: luke-trpc-internal-error-cause
  } catch (err) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed' });
  }
}

export async function bareCatch() {
  try {
    await work();
    // ruleid: luke-trpc-internal-error-cause
  } catch {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed' });
  }
}

export async function keptCause() {
  try {
    await work();
    // ok: luke-trpc-internal-error-cause
  } catch (err) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed', cause: err });
  }
}
