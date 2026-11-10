import { z } from 'zod';

/** Well-known function slugs seeded on first install. Used to guard against accidental deletion. */
export const COMPANY_FUNCTION_SEED_SLUGS = ['product', 'sales', 'sourcing'] as const;
export type CompanyFunctionSeedSlug = (typeof COMPANY_FUNCTION_SEED_SLUGS)[number];

/** Allowed roles for a member within a company team. */
export const CompanyTeamMemberRoleEnum = z.enum(['LEADER', 'MEMBER']);
export type CompanyTeamMemberRole = z.infer<typeof CompanyTeamMemberRoleEnum>;

/**
 * A function's or team's description. A cleared field arrives as '' (or blanks): no description is
 * `null`, whoever the caller. On an update, `null` clears it and a left-out field stays as stored.
 */
const description = z.string().trim().max(500).transform(text => text || null).optional().nullable();

/**
 * Input schema for creating a company function (e.g. Product, Sales, Sourcing). No `.default()`: the
 * update schema below derives from it, and an update must leave an omitted field as stored (#225);
 * `create` defaults them itself.
 */
export const CompanyFunctionInputSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9_]*$/).max(32),
  name: z.string().min(1).max(80),
  description,
  order: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
export type CompanyFunctionInput = z.infer<typeof CompanyFunctionInputSchema>;

/**
 * Input schema for updating a company function. `slug` is immutable after creation, and `isActive`
 * is not an update: a function is deactivated only by `delete` and reactivated only by `restore`,
 * with their checks (#237).
 */
export const CompanyFunctionUpdateInputSchema = CompanyFunctionInputSchema.omit({ slug: true, isActive: true }).extend({
  id: z.uuid(),
});
export type CompanyFunctionUpdateInput = z.infer<typeof CompanyFunctionUpdateInputSchema>;

/**
 * Input schema for creating a team within a company function. No `.default()`, as for functions
 * (#225): the database defaults `isActive`.
 */
export const CompanyTeamInputSchema = z.object({
  functionId: z.uuid(),
  name: z.string().min(1).max(80),
  description,
  isActive: z.boolean().optional(),
  brandIds: z.array(z.uuid()).optional(),
});
export type CompanyTeamInput = z.infer<typeof CompanyTeamInputSchema>;

/**
 * Input schema for updating a team. `functionId` is immutable after creation. Unlike a function, a
 * team keeps `isActive` here: its `delete` is a hard delete and it has no `restore` (#237).
 */
export const CompanyTeamUpdateInputSchema = CompanyTeamInputSchema.omit({ functionId: true }).extend({
  id: z.uuid(),
});
export type CompanyTeamUpdateInput = z.infer<typeof CompanyTeamUpdateInputSchema>;

/** Input schema for adding one or more users to a team with a specified role. */
export const CompanyTeamMembershipInputSchema = z.object({
  teamId: z.uuid(),
  userIds: z.array(z.uuid()).min(1),
  role: CompanyTeamMemberRoleEnum.optional().default('MEMBER'),
});
export type CompanyTeamMembershipInput = z.infer<typeof CompanyTeamMembershipInputSchema>;

/** Input schema for removing one or more users from a team. */
export const CompanyTeamMembershipRemoveInputSchema = z.object({
  teamId: z.uuid(),
  userIds: z.array(z.uuid()).min(1),
});
export type CompanyTeamMembershipRemoveInput = z.infer<typeof CompanyTeamMembershipRemoveInputSchema>;

/** Input schema for changing the role of an existing team member. */
export const CompanyTeamMembershipUpdateRoleInputSchema = z.object({
  teamId: z.uuid(),
  userId: z.uuid(),
  role: CompanyTeamMemberRoleEnum,
});
export type CompanyTeamMembershipUpdateRoleInput = z.infer<typeof CompanyTeamMembershipUpdateRoleInputSchema>;

/** Input schema for granting calendar event visibility to specific users. */
export const CalendarEventUserVisibilityInputSchema = z.object({
  eventId: z.uuid(),
  userIds: z.array(z.uuid()).min(1),
});
export type CalendarEventUserVisibilityInput = z.infer<typeof CalendarEventUserVisibilityInputSchema>;
