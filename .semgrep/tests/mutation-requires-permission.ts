declare function requirePermission(perm: string): unknown;
declare function withRateLimit(name: string): unknown;

interface Builder {
  use(mw: unknown): Builder;
  input(schema: unknown): Builder;
  mutation(handler: unknown): unknown;
}
declare const protectedProcedure: Builder;
declare const BrandInputSchema: unknown;

const router1 = {
  // ruleid: luke-mutation-requires-permission
  create: protectedProcedure
    .input(BrandInputSchema)
    .mutation(async () => {
      return null;
    }),
};

const router2 = {
  // ok: luke-mutation-requires-permission
  create: protectedProcedure
    .use(requirePermission('brands:create'))
    .use(withRateLimit('brandMutations'))
    .input(BrandInputSchema)
    .mutation(async () => {
      return null;
    }),
};
