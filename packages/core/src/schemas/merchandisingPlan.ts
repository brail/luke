import { z } from 'zod';

export const MERCHANDISING_GENDER = ['MAN', 'WOMAN', 'UNISEX', 'KID'] as const;
export type MerchandisingGender = (typeof MERCHANDISING_GENDER)[number];

export const MERCHANDISING_LIFE_TYPE = [
  'NEW_LINE',
  'NEW_STYLE',
  'NEW_COLOR',
  'CARRY_OVER',
] as const;
export type MerchandisingLifeType = (typeof MERCHANDISING_LIFE_TYPE)[number];

export const MERCHANDISING_LAUNCH_TYPE = ['SAMPLED', 'OPEN_TO_BUY'] as const;
export type MerchandisingLaunchType = (typeof MERCHANDISING_LAUNCH_TYPE)[number];

export const SPECSHEET_COMPONENT_SECTIONS = [
  'UPPER',
  'LINING',
  'ACCESSORIES',
  'SOLE',
  'OTHER',
] as const;
export type SpecsheetComponentSection =
  (typeof SPECSHEET_COMPONENT_SECTIONS)[number];

export const MERCHANDISING_PLAN_STATUS = ['DRAFT', 'CONFIRMED'] as const;
export type MerchandisingPlanStatus =
  (typeof MERCHANDISING_PLAN_STATUS)[number];

export const MerchandisingPlanRowInputSchema = z.object({
  planId: z.string().uuid(),
  order: z.number().int().optional(),
  // Required
  articleCode: z.string().min(1),
  styleDescription: z.string().min(1),
  colorCode: z.string().min(1),
  colorDescription: z.string().min(1),
  gender: z.enum(MERCHANDISING_GENDER),
  productCategory: z.string().min(1),
  // Optional — identification
  styleCode: z.string().optional().nullable(),
  lineCode: z.string().optional().nullable(),
  lifeType: z.enum(MERCHANDISING_LIFE_TYPE).optional().nullable(),
  carryoverFromSeason: z.string().optional().nullable(),
  launchType: z.enum(MERCHANDISING_LAUNCH_TYPE).optional().nullable(),
  smsPairsOrder: z.number().int().optional().nullable(),
  targetPairs: z.number().int().optional().nullable(),
  cancellationStatus: z.string().optional().nullable(),
  designer: z.string().optional().nullable(),
  // Optional — pricing
  pricingParameterSetId: z.string().uuid().optional().nullable(),
  targetFobPrice: z.number().positive().optional().nullable(),
  firstOfferPrice: z.number().positive().optional().nullable(),
  finalOfferPrice: z.number().positive().optional().nullable(),
  retailTargetIt: z.number().positive().optional().nullable(),
  wholesaleIt: z.number().positive().optional().nullable(),
  retailTargetEu: z.number().positive().optional().nullable(),
  wholesaleEu: z.number().positive().optional().nullable(),
  // Optional — notes & assignment
  pricingNotes: z.string().optional().nullable(),
  generalNotes: z.string().optional().nullable(),
  assignedUserId: z.string().uuid().optional().nullable(),
});
export type MerchandisingPlanRowInput = z.infer<
  typeof MerchandisingPlanRowInputSchema
>;

export const MerchandisingComponentInputSchema = z.object({
  partNumber: z.string().optional().nullable(),
  component: z.string().min(1),
  section: z.enum(SPECSHEET_COMPONENT_SECTIONS),
  material: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  pantoneNotes: z.string().optional().nullable(),
  order: z.number().int().default(0),
});
export type MerchandisingComponentInput = z.infer<
  typeof MerchandisingComponentInputSchema
>;

export const MerchandisingSpecsheetInputSchema = z.object({
  madeIn: z.string().optional().nullable(),
  supplierName: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type MerchandisingSpecsheetInput = z.infer<
  typeof MerchandisingSpecsheetInputSchema
>;
