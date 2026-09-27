declare const z: { object(shape: Record<string, unknown>): unknown; string(): unknown };
declare function requirePermission(perm: string): unknown;
declare function assertBrandAccess(ctx: unknown, brandId: string): Promise<void>;

interface Builder {
  use(mw: unknown): Builder;
  input(schema: unknown): Builder;
  query(handler: unknown): unknown;
  mutation(handler: unknown): unknown;
}
declare const protectedProcedure: Builder;

export const router = {
  // ruleid: luke-brand-scope-required
  list: protectedProcedure
    .use(requirePermission('pricing:read'))
    .input(z.object({ brandId: z.string(), seasonId: z.string() }))
    .query(async ({ input }: { input: { brandId: string } }) => input.brandId),

  // A key that only ends in BrandId is still a brand.
  // ruleid: luke-brand-scope-required
  copyFromSeason: protectedProcedure
    .use(requirePermission('pricing:update'))
    .input(z.object({ fromBrandId: z.string(), toBrandId: z.string() }))
    .mutation(async () => null),

  // ok: luke-brand-scope-required
  guarded: protectedProcedure
    .use(requirePermission('pricing:read'))
    .input(z.object({ brandId: z.string() }))
    .query(async ({ ctx, input }: { ctx: unknown; input: { brandId: string } }) => {
      await assertBrandAccess(ctx, input.brandId);
      return input.brandId;
    }),

  // ok: luke-brand-scope-required
  byUser: protectedProcedure
    .use(requirePermission('users:read'))
    .input(z.object({ userId: z.string() }))
    .query(async () => null),
};
