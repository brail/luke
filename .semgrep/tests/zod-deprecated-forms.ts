import { z } from 'zod';

declare const BrandIdSchema: z.ZodObject<{ id: z.ZodUUID }>;
declare const HardDeleteConfirmSchema: z.ZodObject<{ confirmPhrase: z.ZodString }>;
declare const planPairInput: z.ZodObject<{ a: z.ZodString }>;
declare const response: { url(): string };
declare const lodash: { merge(a: object, b: object): object };

// ruleid: luke-zod-deprecated-string-format
export const id = z.string().uuid('ID non valido');

// A multi-line chain is reported on the line where the expression starts.
// ruleid: luke-zod-deprecated-string-format
export const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Email non valida');

// ruleid: luke-zod-deprecated-string-format
export const link = z.string().min(1).url().optional();

// ruleid: luke-zod-deprecated-string-format
export const at = z.string().datetime();

// ruleid: luke-zod-deprecated-string-format
export const withParams = z.string({ error: 'Obbligatorio' }).uuid();

// ruleid: luke-zod-deprecated-string-format
export const coerced = z.coerce.string().email();

// ok: luke-zod-deprecated-string-format
export const idFixed = z.uuid('ID non valido');

// ok: luke-zod-deprecated-string-format
export const emailFixed = z.string().trim().toLowerCase().pipe(z.email('Email non valida'));

// ok: luke-zod-deprecated-string-format
export const atFixed = z.iso.datetime();

// ok: luke-zod-deprecated-string-format
export const notZod = response.url();

// ruleid: luke-zod-deprecated-merge
export const hardDelete = BrandIdSchema.merge(HardDeleteConfirmSchema);

// ruleid: luke-zod-deprecated-merge
export const inline = z.object({ rowId: z.uuid() }).merge(HardDeleteConfirmSchema);

// ruleid: luke-zod-deprecated-merge
export const anyName = planPairInput.merge(HardDeleteConfirmSchema);

// ok: luke-zod-deprecated-merge
export const hardDeleteFixed = BrandIdSchema.extend(HardDeleteConfirmSchema.shape);

// ok: luke-zod-deprecated-merge
export const notZodMerge = lodash.merge({}, {});
