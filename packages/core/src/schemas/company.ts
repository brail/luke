import { z } from 'zod';

export const COMPANY_FUNCTION_SEED_SLUGS = ['product', 'sales', 'sourcing'] as const;
export type CompanyFunctionSeedSlug = (typeof COMPANY_FUNCTION_SEED_SLUGS)[number];

export const CompanyTeamMemberRoleEnum = z.enum(['LEADER', 'MEMBER']);
export type CompanyTeamMemberRole = z.infer<typeof CompanyTeamMemberRoleEnum>;

export const CompanyFunctionInputSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9_]*$/).max(32),
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  order: z.number().int().min(0).default(0).optional(),
  isActive: z.boolean().default(true).optional(),
});
export type CompanyFunctionInput = z.infer<typeof CompanyFunctionInputSchema>;

export const CompanyFunctionUpdateInputSchema = CompanyFunctionInputSchema.omit({ slug: true }).extend({
  id: z.string().uuid(),
});
export type CompanyFunctionUpdateInput = z.infer<typeof CompanyFunctionUpdateInputSchema>;

export const CompanyTeamInputSchema = z.object({
  functionId: z.string().uuid(),
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  isActive: z.boolean().default(true).optional(),
  brandIds: z.array(z.string().uuid()).optional(),
});
export type CompanyTeamInput = z.infer<typeof CompanyTeamInputSchema>;

export const CompanyTeamUpdateInputSchema = CompanyTeamInputSchema.omit({ functionId: true }).extend({
  id: z.string().uuid(),
});
export type CompanyTeamUpdateInput = z.infer<typeof CompanyTeamUpdateInputSchema>;

export const CompanyTeamMembershipInputSchema = z.object({
  teamId: z.string().uuid(),
  userIds: z.array(z.string().uuid()).min(1),
  role: CompanyTeamMemberRoleEnum.optional().default('MEMBER'),
});
export type CompanyTeamMembershipInput = z.infer<typeof CompanyTeamMembershipInputSchema>;

export const CompanyTeamMembershipRemoveInputSchema = z.object({
  teamId: z.string().uuid(),
  userIds: z.array(z.string().uuid()).min(1),
});
export type CompanyTeamMembershipRemoveInput = z.infer<typeof CompanyTeamMembershipRemoveInputSchema>;

export const CompanyTeamMembershipUpdateRoleInputSchema = z.object({
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
  role: CompanyTeamMemberRoleEnum,
});
export type CompanyTeamMembershipUpdateRoleInput = z.infer<typeof CompanyTeamMembershipUpdateRoleInputSchema>;

export const CalendarEventUserVisibilityInputSchema = z.object({
  eventId: z.string().uuid(),
  userIds: z.array(z.string().uuid()).min(1),
});
export type CalendarEventUserVisibilityInput = z.infer<typeof CalendarEventUserVisibilityInputSchema>;

// Output schemas for web consumption
export const CompanyFunctionSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  order: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type CompanyFunction = z.infer<typeof CompanyFunctionSchema>;

export const CompanyTeamSchema = z.object({
  id: z.string().uuid(),
  functionId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type CompanyTeam = z.infer<typeof CompanyTeamSchema>;
