/**
 * Schema Zod per Season
 * Definisce validazione e tipi per operazioni CRUD Season
 */

import { z } from 'zod';

export const SeasonInputSchema = z.object({
  code: z
    .string()
    .min(1, 'Codice obbligatorio')
    .max(10, 'Max 10 caratteri')
    .regex(/^[A-Za-z0-9_-]+$/, 'Solo lettere, numeri, _ e -'),

  /** Anno (opzionale, descrittivo) */
  year: z
    .number()
    .int('Anno deve essere intero')
    .min(2000, 'Anno non valido')
    .max(2100, 'Anno non valido')
    .optional()
    .nullable(),

  name: z
    .string()
    .min(1, 'Nome obbligatorio')
    .max(128, 'Max 128 caratteri')
    .trim(),

  /** Codice NAV collegato (opzionale) */
  navSeasonId: z.string().max(10).optional().nullable(),

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

/** Schema di output completo per Season (response dal server) */
export const SeasonSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  year: z.number().nullable(),
  name: z.string(),
  navSeasonId: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type SeasonInput = z.infer<typeof SeasonInputSchema>;
export type SeasonId = z.infer<typeof SeasonIdSchema>;
export type SeasonListInput = z.infer<typeof SeasonListInputSchema>;
export type SeasonUpdateInput = z.infer<typeof SeasonUpdateInputSchema>;
export type Season = z.infer<typeof SeasonSchema>;
