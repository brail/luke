/**
 * Zod schemas for the internal vendor registry (anagrafica fornitori).
 * Vendors are soft-deleted; the NAV sync only updates `name` and never touches `isActive`.
 */

import { z } from 'zod';

import { partialWithoutDefaults } from '../utils/zod.js';

import { HardDeleteConfirmSchema } from './confirmation.js';
import { intInRange } from './number.js';

/** The largest minimum order quantity a vendor can record, in pairs. */
const VENDOR_MOQ_MAX = 100_000;

/** A minimum order quantity in pairs: one message for an empty field, a decimal or a value out of range. */
const moq = (per: string) =>
  intInRange(1, VENDOR_MOQ_MAX, `Inserisci il minimo per ${per}: un numero intero di paia tra 1 e ${VENDOR_MOQ_MAX}`);

/** Input schema for creating an internal vendor record. */
export const VendorInputSchema = z.object({
  name: z.string().trim().min(1, 'Nome obbligatorio').max(255),
  countryCode: z.string().max(10).trim().optional().nullable(),
  // A cleared field arrives as '' and would be stored as the label: everything shows
  // `nickname ?? name`. No nickname is null.
  nickname: z.string().trim().max(64).transform(nickname => nickname || null).optional().nullable(),
  referente: z.string().max(128).trim().optional().nullable(),
  email: z
    .union([z.string().email('Email non valida'), z.null(), z.undefined()])
    .optional(),
  phone: z.string().max(32).trim().optional().nullable(),
  chat: z.string().max(128).trim().optional().nullable(),
  notes: z.string().max(2000).trim().optional().nullable(),
  // Minimum order quantities, in pairs (#124): the colour one is required on every save from the
  // dialog; an update may omit it but, not being nullable, never clear it.
  moqPerLine: moq('linea').nullable().optional(),
  moqPerModel: moq('modello').nullable().optional(),
  moqPerColor: moq('colore'),
  navVendorId: z.string().optional().nullable(),
  enabledParameterSetIds: z.array(z.string().uuid()).optional(),
});

/** Schema for identifying a single vendor by UUID. */
export const VendorIdSchema = z.object({
  id: z.string().uuid('ID vendor non valido'),
});

/** Input schema for permanently deleting a vendor — an id alone is not enough. */
export const VendorHardDeleteInputSchema = VendorIdSchema.merge(HardDeleteConfirmSchema);

/** Input schema for partially updating an existing vendor. */
export const VendorUpdateInputSchema = z.object({
  id: z.string().uuid('ID vendor non valido'),
  data: partialWithoutDefaults(VendorInputSchema),
});

/** Input schema for listing vendors with optional search, active filter, and cursor pagination. */
export const VendorListInputSchema = z.object({
  search: z.string().optional(),
  isActive: z.boolean().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().min(1).max(100).default(100),
});

/** Full vendor record as returned by the API. */
export const VendorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  countryCode: z.string().nullable(),
  nickname: z.string().nullable(),
  referente: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  chat: z.string().nullable(),
  notes: z.string().nullable(),
  moqPerLine: z.number().int().nullable(),
  moqPerModel: z.number().int().nullable(),
  moqPerColor: z.number().int().nullable(),
  navVendorId: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type VendorInput = z.infer<typeof VendorInputSchema>;
export type VendorId = z.infer<typeof VendorIdSchema>;
export type VendorUpdateInput = z.infer<typeof VendorUpdateInputSchema>;
export type VendorListInput = z.infer<typeof VendorListInputSchema>;
export type Vendor = z.infer<typeof VendorSchema>;
