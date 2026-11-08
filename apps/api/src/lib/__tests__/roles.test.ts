import { describe, expectTypeOf, it } from 'vitest';

import type { Role } from '@luke/core';
import type { Role as PrismaRole } from '@luke/db';

describe('Role', () => {
  // Two lists name the roles: `Roles` in core and the Prisma enum the `User.role` column stores.
  // `typecheck:test` fails here when they differ.
  it('core Roles and the Prisma Role enum name the same roles', () => {
    expectTypeOf<Role>().toEqualTypeOf<PrismaRole>();
  });
});
