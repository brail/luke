declare function requirePermission(perm: string): unknown;
declare function withAuditLog(action: string): unknown;
declare function withIdempotency(): unknown;
declare const BrandInputSchema: unknown;

interface Builder {
  use(mw: unknown): Builder;
  input(schema: unknown): Builder;
  mutation(handler: unknown): unknown;
}
declare const protectedProcedure: Builder;

export const router = {
  // ruleid: luke-trpc-middleware-before-input
  create: protectedProcedure
    .use(requirePermission('brands:create'))
    .use(withAuditLog('BRAND_CREATE'))
    .input(BrandInputSchema)
    .mutation(async () => null),

  // ruleid: luke-trpc-middleware-before-input
  upsert: protectedProcedure
    .use(withIdempotency())
    .input(BrandInputSchema)
    .mutation(async () => null),

  // ok: luke-trpc-middleware-before-input
  update: protectedProcedure
    .use(requirePermission('brands:update'))
    .input(BrandInputSchema)
    .use(withAuditLog('BRAND_UPDATE'))
    .use(withIdempotency())
    .mutation(async () => null),
};
