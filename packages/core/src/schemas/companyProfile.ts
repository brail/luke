import { z } from 'zod';

export const CompanyAddressSchema = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  zip: z.string().optional(),
  province: z.string().optional(),
  countryCode: z.string().length(2).default('IT').optional(),
});
export type CompanyAddress = z.infer<typeof CompanyAddressSchema>;

export const CompanyExportSettingsSchema = z.object({
  footerText: z.string().max(200).optional(),
  accentColorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  locale: z.enum(['it-IT', 'en-US']).default('it-IT').optional(),
  dateFormat: z.enum(['DD/MM/YYYY', 'YYYY-MM-DD']).default('DD/MM/YYYY').optional(),
});
export type CompanyExportSettings = z.infer<typeof CompanyExportSettingsSchema>;

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
  logoKey: z.string().optional(),
});
export type CompanyProfileInput = z.infer<typeof CompanyProfileInputSchema>;
