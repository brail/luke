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

/** Settings that control the visual style of exported documents (PDF, XLSX) for this company. */
export const CompanyExportSettingsSchema = z.object({
  footerText: z.string().max(200).optional(),
  accentColorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
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
   * Storage key del logo, dentro il bucket `company-assets`.
   *
   * Vincolata perché finisce direttamente in `readFileBuffer(prisma,
   * 'company-assets', logoKey)` a ogni export PDF: senza formato era una stringa
   * arbitraria scelta dal client che raggiungeva una lettura su storage. Il
   * traversal è già fermato da `validatePathSafety` nel provider locale, ma
   * quella è una difesa due livelli più in là.
   *
   * Il percorso corretto resterebbe quello di `brand.ts`, che non si fida mai
   * dell'input e deriva la key da un `FileObject` verificato.
   */
  logoKey: z
    .string()
    .max(255)
    .regex(/^[a-zA-Z0-9._\-/]+$/, 'Storage key non valida')
    .refine(k => !k.includes('..'), 'Storage key non valida')
    .nullable()
    .optional(),
});
export type CompanyProfileInput = z.infer<typeof CompanyProfileInputSchema>;
