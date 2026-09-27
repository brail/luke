declare const z: { object(shape: Record<string, unknown>): unknown; string(): unknown };
declare function requirePermission(perm: string): unknown;
declare function resolveRowBrandAccess(ctx: unknown, rowId: string): Promise<string>;

interface Builder {
  use(mw: unknown): Builder;
  input(schema: unknown): Builder;
  query(handler: unknown): unknown;
  mutation(handler: unknown): unknown;
}
declare const protectedProcedure: Builder;

export const router = {
  // ruleid: luke-brand-scope-resource-id
  updateRow: protectedProcedure
    .use(requirePermission('collection:update'))
    .input(z.object({ rowId: z.string(), line: z.string() }))
    .mutation(async () => null),

  // ok: luke-brand-scope-resource-id
  guardedRow: protectedProcedure
    .use(requirePermission('collection:update'))
    .input(z.object({ rowId: z.string() }))
    .mutation(async ({ ctx, input }: { ctx: unknown; input: { rowId: string } }) => {
      await resolveRowBrandAccess(ctx, input.rowId);
      return null;
    }),

  // A generic `id` is not a brand-scoped resource key.
  // ok: luke-brand-scope-resource-id
  getById: protectedProcedure
    .use(requirePermission('users:read'))
    .input(z.object({ id: z.string() }))
    .query(async () => null),
};
