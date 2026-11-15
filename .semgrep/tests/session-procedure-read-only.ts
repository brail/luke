declare function requirePermission(perm: unknown): unknown;
declare const maintenanceGuard: unknown;

interface Builder {
  use(mw: unknown): Builder;
  input(schema: unknown): Builder;
  output(schema: unknown): Builder;
  query(handler: unknown): unknown;
  mutation(handler: unknown): unknown;
  subscription(handler: unknown): unknown;
}
declare const sessionProcedure: Builder;
declare const Schema: unknown;

export const router = {
  // ruleid: luke-session-procedure-read-only
  write: sessionProcedure.mutation(async () => null),

  // ruleid: luke-session-procedure-read-only
  chained: sessionProcedure
    .input(Schema)
    .mutation(async () => null),

  // ruleid: luke-session-procedure-read-only
  events: sessionProcedure.subscription(async () => null),

  // A permission does not make a write past the maintenance guard acceptable.
  // ruleid: luke-session-procedure-read-only
  permitted: sessionProcedure.use(requirePermission('x:update')).mutation(async () => null),

  // The permission rule's suppression is not this rule's.
  // nosemgrep: luke-procedure-requires-permission -- reason for the other rule only
  // ruleid: luke-session-procedure-read-only
  suppressed: sessionProcedure.mutation(async () => null),

  // ok: luke-session-procedure-read-only
  status: sessionProcedure.output(Schema).query(async () => null),
};

// The builder that adds the guard on top of it is a definition, not a write.
// ok: luke-session-procedure-read-only
export const protectedProcedure = sessionProcedure.use(maintenanceGuard);
