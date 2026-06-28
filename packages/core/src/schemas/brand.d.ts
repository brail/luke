/**
 * Schema Zod per Brand
 * Definisce validazione e tipi per operazioni CRUD Brand
 */
import { z } from 'zod';
/**
 * Schema per input Brand (create/update)
 * Utilizzato per validazione input in tRPC procedures
 */
export declare const BrandInputSchema: z.ZodObject<{
    code: z.ZodString;
    name: z.ZodString;
    logoKey: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull, z.ZodUndefined]>>;
    fileObjectId: z.ZodOptional<z.ZodString>;
    navBrandId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    isActive: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
/**
 * Schema per ID Brand
 * Utilizzato per operazioni su singolo brand
 */
export declare const BrandIdSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
/**
 * Schema per Brand completo (output)
 * Utilizzato per response tRPC e type inference
 */
export declare const BrandSchema: z.ZodObject<{
    id: z.ZodString;
    code: z.ZodString;
    name: z.ZodString;
    logoUrl: z.ZodNullable<z.ZodString>;
    navBrandId: z.ZodNullable<z.ZodString>;
    isActive: z.ZodBoolean;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
}, z.core.$strip>;
/**
 * Schema per lista Brand con filtri opzionali e cursor pagination
 * Utilizzato per query con filtri e paginazione
 */
export declare const BrandListInputSchema: z.ZodObject<{
    isActive: z.ZodOptional<z.ZodBoolean>;
    search: z.ZodOptional<z.ZodString>;
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
/**
 * Schema per update Brand
 * Combina ID e dati parziali per update
 */
export declare const BrandUpdateInputSchema: z.ZodObject<{
    id: z.ZodString;
    data: z.ZodObject<{
        isActive: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
        logoKey: z.ZodOptional<z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull, z.ZodUndefined]>>>;
        fileObjectId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        navBrandId: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
        code: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
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
export declare const BrandLogoUploadSchema: z.ZodObject<{
    brandId: z.ZodString;
    file: z.ZodObject<{
        filename: z.ZodString;
        mimetype: z.ZodString;
        size: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
export type BrandLogoUpload = z.infer<typeof BrandLogoUploadSchema>;
/**
 * Normalizza il codice brand per consistency
 * - Trimma spazi bianchi
 * - Converte in maiuscolo
 * - Rimuove caratteri non validi (mantiene solo A-Z, 0-9, _, -)
 *
 * @param code - Codice brand da normalizzare
 * @returns Codice normalizzato
 */
export declare function normalizeCode(code: string): string;
//# sourceMappingURL=brand.d.ts.map