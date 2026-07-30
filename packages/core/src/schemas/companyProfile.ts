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
   * Rimozione del logo. `null` è l'unico valore accettato, e significa "togli".
   *
   * Era una storage key scelta dal client, che finiva dritta in
   * `readFileBuffer(prisma, 'company-assets', logoKey)` a ogni export PDF. Prima
   * senza formato, poi vincolata a una regex — ma una regex è una feritoia più
   * stretta, non un muro. Ora il client non può più nominare una key: per
   * *impostare* un logo passa un `fileObjectId`, e la key la deriva il server da
   * un `FileObject` verificato.
   *
   * `z.null()` e non la rimozione del campo perché il canale di cancellazione
   * deve sopravvivere, ed è già così che il frontend lo esprime.
   */
  logoKey: z.null().optional(),

  /**
   * `FileObject` pending da collegare come logo, ottenuto dall'upload.
   *
   * Stesso pattern di `brand.ts`: il server verifica che sia pending, tuo e nel
   * bucket giusto, poi ne scrive la key.
   */
  fileObjectId: z.string().uuid().optional(),
});
export type CompanyProfileInput = z.infer<typeof CompanyProfileInputSchema>;
