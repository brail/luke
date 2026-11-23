declare function requirePermission<T = unknown>(perm: unknown): unknown;
declare function withRateLimit(name: string): unknown;

interface Builder {
  use(mw: unknown): Builder;
  input(schema: unknown): Builder;
  query(handler: unknown): unknown;
  mutation(handler: unknown): unknown;
}
declare const protectedProcedure: Builder;
declare const PreviewInputSchema: unknown;
type PreviewInput = { id: string };

export const router = {
  // ruleid: luke-query-mutating-permission
  sameLine: protectedProcedure.use(requirePermission('config:update')).query(async () => null),

  // ruleid: luke-query-mutating-permission
  splitArguments: protectedProcedure
    .use(
      requirePermission(
        'seasons:delete'
      )
    )
    .query(async () => null),

  // ruleid: luke-query-mutating-permission
  configure: protectedProcedure
    .use(withRateLimit('x'))
    .use(requirePermission('season_calendar:configure'))
    .query(async () => null),

  // ruleid: luke-query-mutating-permission
  generic: protectedProcedure
    .input(PreviewInputSchema)
    .use(requirePermission<PreviewInput>('collection_layout:update'))
    .query(async () => null),

  // ruleid: luke-query-mutating-permission
  array: protectedProcedure
    .use(requirePermission(['brands:read', 'brands:update']))
    .query(async () => null),

  // ruleid: luke-query-mutating-permission
  declaration: protectedProcedure
    .use(requirePermission({ required: 'users:update', description: 'x' }))
    .query(async () => null),

  // The marker must be inside the chain, not above the key.
  // Rule 5: preview of router.apply, out of the chain.
  // ruleid: luke-query-mutating-permission
  markerOutside: protectedProcedure
    .use(requirePermission('config:update'))
    .query(async () => null),

  // ruleid: luke-query-mutating-permission
  markerBeforeMiddleware: protectedProcedure
    // Rule 5: preview of router.apply, but above the middleware.
    .use(requirePermission('config:update'))
    .query(async () => null),

  // ruleid: luke-query-mutating-permission
  markerInHandler: protectedProcedure
    .use(requirePermission('config:update'))
    .query(async () => {
      // Rule 5: an unrelated comment in the handler.
      return null;
    }),

  // ruleid: luke-query-mutating-permission
  resourceWildcard: protectedProcedure.use(requirePermission('brands:*')).query(async () => null),

  // ruleid: luke-query-mutating-permission
  digit: protectedProcedure.use(requirePermission('s3_bucket2:update')).query(async () => null),

  // ruleid: luke-query-mutating-permission
  markerInString: protectedProcedure
    .use(requirePermission('config:update'))
    .query(async () => '// Rule 5: preview of router.apply'),

  // ok: luke-query-mutating-permission
  preview: protectedProcedure
    .use(requirePermission('config:update'))
    // Rule 5: preview of router.apply, whose permission it takes.
    .input(PreviewInputSchema)
    .query(async () => null),

  // ok: luke-query-mutating-permission
  dialogRead: protectedProcedure
    .use(requirePermission(['brands:create', 'brands:update']))
    // Rule 5: dialog-only read, the brand dialog's picker.
    .query(async () => null),

  // ok: luke-query-mutating-permission
  read: protectedProcedure.use(requirePermission('brands:read')).query(async () => null),

  // ok: luke-query-mutating-permission
  readAll: protectedProcedure.use(requirePermission('audit:read_all')).query(async () => null),

  // ok: luke-query-mutating-permission
  revisions: protectedProcedure.use(requirePermission('collection_layout:view_revisions')).query(async () => null),

  // ok: luke-query-mutating-permission
  exported: protectedProcedure.use(requirePermission('season_calendar:export')).query(async () => null),

  // ok: luke-query-mutating-permission
  admin: protectedProcedure.use(requirePermission('*:*')).query(async () => null),

  // A commented-out middleware is no gate.
  // ok: luke-query-mutating-permission
  commentedOut: protectedProcedure
    // .use(requirePermission('config:update'))
    .use(requirePermission('config:read'))
    .query(async () => null),

  // A mutation is never flagged.
  // ok: luke-query-mutating-permission
  apply: protectedProcedure.use(requirePermission('config:update')).mutation(async () => null),

  // A resolver that can return a mutating permission counts too.
  // ruleid: luke-query-mutating-permission
  resolver: protectedProcedure
    .input(PreviewInputSchema)
    .use(requirePermission<PreviewInput>(input => (input.id ? 'config:update' : 'config:read')))
    .query(async () => null),

  // ok: luke-query-mutating-permission
  markedSplitArguments: protectedProcedure
    .use(
      requirePermission(
        'seasons:delete'
      )
    )
    // Rule 5: preview of router.purge, whose permission it takes.
    .query(async () => null),

  // ok: luke-query-mutating-permission
  markedResolver: protectedProcedure
    .input(PreviewInputSchema)
    .use(requirePermission<PreviewInput>(input => (input.id ? 'config:update' : 'config:read')))
    // Rule 5: preview of router.apply, whose permission it takes.
    .query(async () => null),

  // ok: luke-query-mutating-permission
  // nosemgrep: luke-query-mutating-permission -- a reasoned exception, above the key as in the routers
  suppressed: protectedProcedure
    .use(requirePermission('config:update'))
    .query(async () => null),
};
