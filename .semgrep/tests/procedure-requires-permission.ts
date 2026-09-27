declare function requirePermission(perm: unknown): unknown;
declare function withRateLimit(name: string): unknown;

interface Builder {
  use(mw: unknown): Builder;
  input(schema: unknown): Builder;
  query(handler: unknown): unknown;
  mutation(handler: unknown): unknown;
  subscription(handler: unknown): unknown;
}
declare const protectedProcedure: Builder;
declare const selfProcedure: Builder;
declare const publicProcedure: Builder;
declare const adminProcedure: Builder;
declare const BrandInputSchema: unknown;
type TargetInput = { targetType: string };

export const router = {
  // ruleid: luke-procedure-requires-permission
  create: protectedProcedure
    .input(BrandInputSchema)
    .mutation(async () => null),

  // ruleid: luke-procedure-requires-permission
  list: protectedProcedure.query(async () => []),

  // ruleid: luke-procedure-requires-permission
  events: protectedProcedure.subscription(async () => null),

  // A mention in the handler is not a middleware.
  // ruleid: luke-procedure-requires-permission
  mentioned: protectedProcedure.use(withRateLimit('x')).mutation(async () => requirePermission),

  // A commented-out middleware is not one either.
  // ruleid: luke-procedure-requires-permission
  commentedOut: protectedProcedure
    // .use(requirePermission('users:read'))
    .query(async () => null),

  // ruleid: luke-procedure-requires-permission
  blockComment: protectedProcedure /* .use(requirePermission('users:read')) */ .query(async () => null),

  nested: {
    // ruleid: luke-procedure-requires-permission
    inner: protectedProcedure.query(async () => null),
  },

  // ok: luke-procedure-requires-permission
  update: protectedProcedure
    .use(requirePermission('brands:update'))
    .use(withRateLimit('brandMutations'))
    .input(BrandInputSchema)
    .mutation(async () => null),

  // ok: luke-procedure-requires-permission
  byInput: protectedProcedure
    .input(BrandInputSchema)
    .use(requirePermission((input: TargetInput) => `${input.targetType}:read`))
    .query(async () => null),

  // ok: luke-procedure-requires-permission
  generic: protectedProcedure
    .input(BrandInputSchema)
    .use(requirePermission<TargetInput>((input: TargetInput) => input.targetType))
    .query(async () => null),

  // ok: luke-procedure-requires-permission
  sameLine: protectedProcedure.use(requirePermission('brands:read')).query(async () => []),

  // ok: luke-procedure-requires-permission
  mine: selfProcedure.query(async () => null),

  // ok: luke-procedure-requires-permission
  login: publicProcedure.input(BrandInputSchema).mutation(async () => null),

  // ok: luke-procedure-requires-permission
  schedule: adminProcedure.mutation(async () => null),
};

// The root anchor cannot see through a named builder, so none may exist.
// ruleid: luke-procedure-requires-permission
const aliased = protectedProcedure;
// ruleid: luke-procedure-requires-permission
const partial = protectedProcedure.input(BrandInputSchema);

export const other = { a: aliased.query(async () => null), b: partial.query(async () => null) };
