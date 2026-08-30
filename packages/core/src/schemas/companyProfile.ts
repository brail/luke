import { z } from 'zod';

/** Physical address of the company, embedded in `CompanyProfile`. */
export const CompanyAddressSchema = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  zip: z.string().optional(),
  province: z.string().optional(),
  countryCode: z.string().length(2).default('IT').optional(),
});
export type CompanyAddress = z.infer<typeof CompanyAddressSchema>;

/**
 * Length of the export footer, exported so the input that collects it can cap at the same number
 * instead of restating it: an HTML `maxLength` silently truncates, so a drift here would cut text
 * the schema would have accepted, with nothing to notice.
 */
export const COMPANY_FOOTER_TEXT_MAX = 200;

/** Hex digits in an accent colour, `#RRGGBB` — the schema's regex is built from this. */
const COMPANY_ACCENT_COLOR_DIGITS = 6;

/** What the input accepts, `#` included. Derived, so the two cannot say different numbers. */
export const COMPANY_ACCENT_COLOR_LENGTH = COMPANY_ACCENT_COLOR_DIGITS + 1;

/** Settings that control the visual style of exported documents (PDF, XLSX) for this company. */
export const CompanyExportSettingsSchema = z.object({
  footerText: z.string().max(COMPANY_FOOTER_TEXT_MAX).optional(),
  accentColorHex: z
    .string()
    .regex(new RegExp(`^#[0-9A-Fa-f]{${COMPANY_ACCENT_COLOR_DIGITS}}$`))
    .optional(),
  locale: z.enum(['it-IT', 'en-US']).default('it-IT').optional(),
  dateFormat: z.enum(['DD/MM/YYYY', 'YYYY-MM-DD']).default('DD/MM/YYYY').optional(),
});
export type CompanyExportSettings = z.infer<typeof CompanyExportSettingsSchema>;

/** Input schema for creating or updating the singleton company profile (legal identity + branding). */
export const CompanyProfileInputSchema = z.object({
  legalName: z.string().min(1).max(200),
  displayName: z.string().min(1).max(100),
  vatNumber: z.string().optional(),
  taxCode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  website: z.string().url().optional(),
  address: CompanyAddressSchema.optional(),
  exportSettings: CompanyExportSettingsSchema.optional(),
  /**
   * Logo removal. `null` is the only accepted value, and means "remove".
   *
   * Was a storage key chosen by the client, which went straight into
   * `readFileBuffer(prisma, 'company-assets', logoKey)` on every PDF export. First
   * unformatted, then constrained to a regex — but a regex is a narrower gap, not a wall. Now
   * the client can no longer name a key: to *set* a logo it passes a `fileObjectId`, and
   * the server derives the key from a verified `FileObject`.
   *
   * `z.null()` and not field removal because the deletion channel
   * must survive, and this is already how the frontend expresses it.
   */
  logoKey: z.null().optional(),

  /**
   * `FileObject` pending to be attached as logo, obtained from upload.
   *
   * Same pattern as `brand.ts`: the server verifies it is pending, yours and in the
   * correct bucket, then writes its key.
   */
  fileObjectId: z.string().uuid().optional(),
});
export type CompanyProfileInput = z.infer<typeof CompanyProfileInputSchema>;
