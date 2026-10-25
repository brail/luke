import { Prisma } from '@luke/db';

/**
 * A Prisma known-request error as the PostgreSQL driver adapter reports a constraint refusal: the
 * constraint under `meta.driverAdapterError.cause.constraint.index`
 * (`constraintViolation.integration.spec.ts` reads the shape from a real refusal).
 */
export function prismaKnownError(code: string, constraint?: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('refused', {
    code,
    clientVersion: 'test',
    meta: constraint ? { driverAdapterError: { cause: { constraint: { index: constraint } } } } : undefined,
  });
}
