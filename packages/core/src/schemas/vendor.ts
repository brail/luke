/**
 * Schema Zod per Vendor (anagrafica interna fornitori)
 */

import { z } from 'zod';

export const VendorInputSchema = z.object({
  name: z.string().min(1, 'Nome obbligatorio').max(255).trim(),
  nickname: z.string().max(64).trim().optional().nullable(),
  referente: z.string().max(128).trim().optional().nullable(),
  email: z
    .union([z.string().email('Email non valida'), z.null(), z.undefined()])
    .optional(),
  phone: z.string().max(32).trim().optional().nullable(),
  chat: z.string().max(128).trim().optional().nullable(),
  notes: z.string().max(2000).trim().optional().nullable(),
  navVendorId: z.string().optional().nullable(),
});

export const VendorIdSchema = z.object({
  id: z.string().uuid('ID vendor non valido'),
});

export const VendorUpdateInputSchema = z.object({
  id: z.string().uuid('ID vendor non valido'),
  data: VendorInputSchema.partial(),
});

export const VendorListInputSchema = z.object({
  search: z.string().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().min(1).max(200).default(100),
});

export const VendorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  nickname: z.string().nullable(),
  referente: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  chat: z.string().nullable(),
  notes: z.string().nullable(),
  navVendorId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type VendorInput = z.infer<typeof VendorInputSchema>;
export type VendorId = z.infer<typeof VendorIdSchema>;
export type VendorUpdateInput = z.infer<typeof VendorUpdateInputSchema>;
export type VendorListInput = z.infer<typeof VendorListInputSchema>;
export type Vendor = z.infer<typeof VendorSchema>;
