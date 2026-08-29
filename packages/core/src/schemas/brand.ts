/**
 * Zod schemas for Brand — create, update, list, logo upload, and output shapes.
 * `Brand.code` is max 20 chars, aligned to NAV nvarchar constraints.
 */

import { z } from 'zod';

import { partialWithoutDefaults } from '../utils/zod';

import { HardDeleteConfirmSchema } from './confirmation';

/** Input schema for creating a brand. Code must be alphanumeric with `_` and `-`, max 20 chars. */
export const BrandInputSchema = z.object({
  /** Unique brand code (max 20 characters) */
  code: z
    .string()
    .min(1, 'Codice obbligatorio')
    .max(20, 'Max 20 caratteri')
    .regex(/^[A-Za-z0-9_-]+$/, 'Solo lettere, numeri, _ e -'),

  /** Brand name (max 128 characters) */
  name: z
    .string()
    .min(1, 'Nome obbligatorio')
    .max(128, 'Max 128 caratteri')
    .trim(),

  /**
   * Logo removal. `null` is the only accepted value, and means "remove".
   *
   * Was a free string without regex or length, which survived the
   * destructure and ended up in `tx.brand.create` — the same storage key selected by
   * the client that was closed for the company profile. The brand dialog only sends it
   * to delete; to *set* a logo it passes `fileObjectId`, and the
   * dedicated upload route writes the key server-side without passing through here.
   */
  logoKey: z.null().optional(),

  /** Pending FileObject ID for logo during brand creation (optional) */
  fileObjectId: z.string().uuid('ID file non valido').optional(),

  /** Associated NAV code (optional) */
  navBrandId: z.string().max(20).optional().nullable(),

  /** Active status of the brand (default: true) */
  isActive: z.boolean().default(true),
});

/** Schema for identifying a single brand by UUID. */
export const BrandIdSchema = z.object({
  /** UUID of the brand */
  id: z.string().uuid('ID brand non valido'),
});

/** Input schema for permanently deleting a brand — an id alone is not enough. */
export const BrandHardDeleteInputSchema = BrandIdSchema.merge(HardDeleteConfirmSchema);

/** Full brand record as returned by the API (includes all fields). */
export const BrandSchema = z.object({
  /** UUID of the brand */
  id: z.string().uuid(),

  /** Unique brand code */
  code: z.string(),

  /** Brand name */
  name: z.string(),

  /** Logo URL (nullable) */
  logoUrl: z.string().nullable(),

  /** Associated NAV code (nullable) */
  navBrandId: z.string().nullable(),

  /** Active status of the brand */
  isActive: z.boolean(),

  /** Creation date */
  createdAt: z.date(),

  /** Last update date */
  updatedAt: z.date(),
});

/** Input schema for listing brands with optional search, active filter, and cursor pagination. */
export const BrandListInputSchema = z.object({
  /** Filter for active/inactive brands */
  isActive: z.boolean().optional(),

  /** Search term for name or code */
  search: z.string().optional(),

  /** Cursor for pagination (brand UUID) */
  cursor: z.string().uuid().optional(),

  /** Result limit per page (1-100, default 50) */
  limit: z.number().min(1).max(100).default(50),
});

/** Input schema for partially updating a brand. Relaxes code/name regex to allow NAV codes with spaces. */
export const BrandUpdateInputSchema = z.object({
  /** UUID of the brand to update */
  id: z.string().uuid('ID brand non valido'),

  /** Partial data for update — code/name without regex: NAV codes can contain spaces */
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
  /** UUID of the brand */
  brandId: z.string().uuid('Brand ID deve essere un UUID valido'),

  /** File information */
  file: z.object({
    /** Original file name */
    filename: z.string().min(1, 'Nome file obbligatorio'),

    /** MIME type of the file */
    mimetype: z.string().min(1, 'MIME type obbligatorio'),

    /** File size in bytes */
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
