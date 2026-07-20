/**
 * Zod schemas for Brand — create, update, list, logo upload, and output shapes.
 * `Brand.code` is max 20 chars, aligned to NAV nvarchar constraints.
 */

import { z } from 'zod';

import { partialWithoutDefaults } from '../utils/zod';

/** Input schema for creating a brand. Code must be alphanumeric with `_` and `-`, max 20 chars. */
export const BrandInputSchema = z.object({
  /** Codice univoco del brand (max 20 caratteri) */
  code: z
    .string()
    .min(1, 'Codice obbligatorio')
    .max(20, 'Max 20 caratteri')
    .regex(/^[A-Za-z0-9_-]+$/, 'Solo lettere, numeri, _ e -'),

  /** Nome del brand (max 128 caratteri) */
  name: z
    .string()
    .min(1, 'Nome obbligatorio')
    .max(128, 'Max 128 caratteri')
    .trim(),

  /** Storage key del logo (opzionale, nullable) */
  logoKey: z
    .union([z.string(), z.null(), z.undefined()])
    .optional(),

  /** ID FileObject pending per logo durante creazione brand (opzionale) */
  fileObjectId: z.string().uuid('ID file non valido').optional(),

  /** Codice NAV collegato (opzionale) */
  navBrandId: z.string().max(20).optional().nullable(),

  /** Stato attivo del brand (default: true) */
  isActive: z.boolean().default(true),
});

/** Schema for identifying a single brand by UUID. */
export const BrandIdSchema = z.object({
  /** UUID del brand */
  id: z.string().uuid('ID brand non valido'),
});

/** Full brand record as returned by the API (includes all fields). */
export const BrandSchema = z.object({
  /** UUID del brand */
  id: z.string().uuid(),

  /** Codice univoco del brand */
  code: z.string(),

  /** Nome del brand */
  name: z.string(),

  /** URL del logo (nullable) */
  logoUrl: z.string().nullable(),

  /** Codice NAV collegato (nullable) */
  navBrandId: z.string().nullable(),

  /** Stato attivo del brand */
  isActive: z.boolean(),

  /** Data di creazione */
  createdAt: z.date(),

  /** Data di ultimo aggiornamento */
  updatedAt: z.date(),
});

/** Input schema for listing brands with optional search, active filter, and cursor pagination. */
export const BrandListInputSchema = z.object({
  /** Filtro per brand attivi/disattivi */
  isActive: z.boolean().optional(),

  /** Termine di ricerca per nome o codice */
  search: z.string().optional(),

  /** Cursor per paginazione (UUID del brand) */
  cursor: z.string().uuid().optional(),

  /** Limite risultati per pagina (1-100, default 50) */
  limit: z.number().min(1).max(100).default(50),
});

/** Input schema for partially updating a brand. Relaxes code/name regex to allow NAV codes with spaces. */
export const BrandUpdateInputSchema = z.object({
  /** UUID del brand da aggiornare */
  id: z.string().uuid('ID brand non valido'),

  /** Dati parziali per l'aggiornamento — code/name senza regex: i codici NAV possono contenere spazi */
  data: partialWithoutDefaults(
    BrandInputSchema
      .omit({ code: true, name: true })
      .extend({
        code: z.string().min(1, 'Codice obbligatorio').max(20, 'Max 20 caratteri'),
        name: z.string().min(1, 'Nome obbligatorio').max(128, 'Max 128 caratteri'),
      })
  ),
});

export type BrandInput = z.infer<typeof BrandInputSchema>;
export type BrandId = z.infer<typeof BrandIdSchema>;
export type Brand = z.infer<typeof BrandSchema>;
export type BrandListInput = z.infer<typeof BrandListInputSchema>;
export type BrandUpdateInput = z.infer<typeof BrandUpdateInputSchema>;

/** Input schema for validating a brand logo file upload request. */
export const BrandLogoUploadSchema = z.object({
  /** UUID del brand */
  brandId: z.string().uuid('Brand ID deve essere un UUID valido'),

  /** Informazioni del file */
  file: z.object({
    /** Nome originale del file */
    filename: z.string().min(1, 'Nome file obbligatorio'),

    /** MIME type del file */
    mimetype: z.string().min(1, 'MIME type obbligatorio'),

    /** Dimensione del file in bytes */
    size: z.number().int().positive('Dimensione file deve essere positiva'),
  }),
});

export type BrandLogoUpload = z.infer<typeof BrandLogoUploadSchema>;

/**
 * Normalizes a brand code for consistency: trims whitespace, uppercases,
 * and strips any character that is not A–Z, 0–9, `_`, `-`, or space.
 *
 * @returns Normalized uppercase code
 */
export function normalizeCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_ -]/g, '');
}
