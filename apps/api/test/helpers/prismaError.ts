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

/**
 * A Prisma validation error in the argument-tree form (`withoutQueryArguments` in `@luke/core`), with `value` as
 * the query value its text renders.
 */
export function prismaValidationError(value: string): Prisma.PrismaClientValidationError {
  const text = [
    '',
    'Invalid `prisma.user.findFirst()` invocation:',
    '',
    '{',
    '  where: {',
    `    username: "${value}",`,
    '    notAField: "x",',
    '    ~~~~~~~~~',
    '?   AND?: UserWhereInput | UserWhereInput[],',
    '?   id?: StringFilter | String',
    '  }',
    '}',
    '',
    'Unknown argument `notAField`. Available options are marked with ?.',
  ].join('\n');
  return new Prisma.PrismaClientValidationError(text, { clientVersion: 'test' });
}
