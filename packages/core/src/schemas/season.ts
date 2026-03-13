/**
 * Schema Zod per Season
 * Definisce validazione e tipi per operazioni CRUD Season
 */

import { z } from 'zod';

export const SeasonInputSchema = z.object({
  code: z
    .string()
    .min(1, 'Codice obbligatorio')
    .max(8, 'Max 8 caratteri')
    .regex(/^[A-Za-z0-9_-]+$/, 'Solo lettere, numeri, _ e -'),

  year: z
    .number()
    .int('Anno deve essere intero')
    .min(2000, 'Anno non valido')
    .max(2100, 'Anno non valido'),

  name: z
    .string()
    .min(1, 'Nome obbligatorio')
    .max(128, 'Max 128 caratteri')
    .trim(),

  isActive: z.boolean().default(true),
});

export const SeasonIdSchema = z.object({
  id: z.string().uuid('ID season non valido'),
});

export const SeasonListInputSchema = z.object({
  isActive: z.boolean().optional(),
  search: z.string().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().min(1).max(100).default(50),
});

export const SeasonUpdateInputSchema = z.object({
  id: z.string().uuid('ID season non valido'),
  data: SeasonInputSchema.partial(),
});

export type SeasonInput = z.infer<typeof SeasonInputSchema>;
export type SeasonId = z.infer<typeof SeasonIdSchema>;
export type SeasonListInput = z.infer<typeof SeasonListInputSchema>;
export type SeasonUpdateInput = z.infer<typeof SeasonUpdateInputSchema>;
