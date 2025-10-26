/**
 * Schema Zod per Brand
 * Definisce validazione e tipi per operazioni CRUD Brand
 */

import { z } from 'zod';

/**
 * Schema per input Brand (create/update)
 * Utilizzato per validazione input in tRPC procedures
 */
export const BrandInputSchema = z.object({
  /** Codice univoco del brand (max 16 caratteri) */
  code: z
    .string()
    .min(1, 'Codice obbligatorio')
    .max(16, 'Max 16 caratteri')
    .regex(/^[A-Z0-9_-]+$/, 'Solo maiuscole, numeri, _ e -'),

  /** Nome del brand (max 128 caratteri) */
  name: z
    .string()
    .min(1, 'Nome obbligatorio')
    .max(128, 'Max 128 caratteri')
    .trim(),

  /** URL del logo (opzionale, nullable) */
  logoUrl: z
    .union([z.string().url('URL non valido'), z.null(), z.undefined()])
    .optional(),

  /** Stato attivo del brand (default: true) */
  isActive: z.boolean().default(true),
});

/**
 * Schema per ID Brand
 * Utilizzato per operazioni su singolo brand
 */
export const BrandIdSchema = z.object({
  /** UUID del brand */
  id: z.string().uuid('ID brand non valido'),
});

/**
 * Schema per Brand completo (output)
 * Utilizzato per response tRPC e type inference
 */
export const BrandSchema = z.object({
  /** UUID del brand */
  id: z.string().uuid(),

  /** Codice univoco del brand */
  code: z.string(),

  /** Nome del brand */
  name: z.string(),

  /** URL del logo (nullable) */
  logoUrl: z.string().nullable(),

  /** Stato attivo del brand */
  isActive: z.boolean(),

  /** Data di creazione */
  createdAt: z.date(),

  /** Data di ultimo aggiornamento */
  updatedAt: z.date(),
});

/**
 * Schema per lista Brand con filtri opzionali
 * Utilizzato per query con filtri
 */
export const BrandListInputSchema = z.object({
  /** Filtro per brand attivi/disattivi */
  isActive: z.boolean().optional(),

  /** Termine di ricerca per nome o codice */
  search: z.string().optional(),
});

/**
 * Schema per update Brand
 * Combina ID e dati parziali per update
 */
export const BrandUpdateInputSchema = z.object({
  /** UUID del brand da aggiornare */
  id: z.string().uuid('ID brand non valido'),

  /** Dati parziali per l'aggiornamento */
  data: BrandInputSchema.partial(),
});

/**
 * Tipi TypeScript inferiti dagli schemi
 */
export type BrandInput = z.infer<typeof BrandInputSchema>;
export type BrandId = z.infer<typeof BrandIdSchema>;
export type Brand = z.infer<typeof BrandSchema>;
export type BrandListInput = z.infer<typeof BrandListInputSchema>;
export type BrandUpdateInput = z.infer<typeof BrandUpdateInputSchema>;

/**
 * Schema per upload logo Brand
 * Utilizzato per validazione file upload
 */
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
