"use strict";
/**
 * Schema Zod per Brand
 * Definisce validazione e tipi per operazioni CRUD Brand
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrandLogoUploadSchema = exports.BrandUpdateInputSchema = exports.BrandListInputSchema = exports.BrandSchema = exports.BrandIdSchema = exports.BrandInputSchema = void 0;
exports.normalizeCode = normalizeCode;
const zod_1 = require("zod");
/**
 * Schema per input Brand (create/update)
 * Utilizzato per validazione input in tRPC procedures
 */
exports.BrandInputSchema = zod_1.z.object({
    /** Codice univoco del brand (max 20 caratteri) */
    code: zod_1.z
        .string()
        .min(1, 'Codice obbligatorio')
        .max(20, 'Max 20 caratteri')
        .regex(/^[A-Za-z0-9_-]+$/, 'Solo lettere, numeri, _ e -'),
    /** Nome del brand (max 128 caratteri) */
    name: zod_1.z
        .string()
        .min(1, 'Nome obbligatorio')
        .max(128, 'Max 128 caratteri')
        .trim(),
    /** Storage key del logo (opzionale, nullable) */
    logoKey: zod_1.z
        .union([zod_1.z.string(), zod_1.z.null(), zod_1.z.undefined()])
        .optional(),
    /** ID FileObject pending per logo durante creazione brand (opzionale) */
    fileObjectId: zod_1.z.string().uuid('ID file non valido').optional(),
    /** Codice NAV collegato (opzionale) */
    navBrandId: zod_1.z.string().max(20).optional().nullable(),
    /** Stato attivo del brand (default: true) */
    isActive: zod_1.z.boolean().default(true),
});
/**
 * Schema per ID Brand
 * Utilizzato per operazioni su singolo brand
 */
exports.BrandIdSchema = zod_1.z.object({
    /** UUID del brand */
    id: zod_1.z.string().uuid('ID brand non valido'),
});
/**
 * Schema per Brand completo (output)
 * Utilizzato per response tRPC e type inference
 */
exports.BrandSchema = zod_1.z.object({
    /** UUID del brand */
    id: zod_1.z.string().uuid(),
    /** Codice univoco del brand */
    code: zod_1.z.string(),
    /** Nome del brand */
    name: zod_1.z.string(),
    /** URL del logo (nullable) */
    logoUrl: zod_1.z.string().nullable(),
    /** Codice NAV collegato (nullable) */
    navBrandId: zod_1.z.string().nullable(),
    /** Stato attivo del brand */
    isActive: zod_1.z.boolean(),
    /** Data di creazione */
    createdAt: zod_1.z.date(),
    /** Data di ultimo aggiornamento */
    updatedAt: zod_1.z.date(),
});
/**
 * Schema per lista Brand con filtri opzionali e cursor pagination
 * Utilizzato per query con filtri e paginazione
 */
exports.BrandListInputSchema = zod_1.z.object({
    /** Filtro per brand attivi/disattivi */
    isActive: zod_1.z.boolean().optional(),
    /** Termine di ricerca per nome o codice */
    search: zod_1.z.string().optional(),
    /** Cursor per paginazione (UUID del brand) */
    cursor: zod_1.z.string().uuid().optional(),
    /** Limite risultati per pagina (1-100, default 50) */
    limit: zod_1.z.number().min(1).max(100).default(50),
});
/**
 * Schema per update Brand
 * Combina ID e dati parziali per update
 */
exports.BrandUpdateInputSchema = zod_1.z.object({
    /** UUID del brand da aggiornare */
    id: zod_1.z.string().uuid('ID brand non valido'),
    /** Dati parziali per l'aggiornamento — code/name senza regex: i codici NAV possono contenere spazi */
    data: exports.BrandInputSchema
        .omit({ code: true, name: true })
        .extend({
        code: zod_1.z.string().min(1, 'Codice obbligatorio').max(20, 'Max 20 caratteri'),
        name: zod_1.z.string().min(1, 'Nome obbligatorio').max(128, 'Max 128 caratteri'),
    })
        .partial(),
});
/**
 * Schema per upload logo Brand
 * Utilizzato per validazione file upload
 */
exports.BrandLogoUploadSchema = zod_1.z.object({
    /** UUID del brand */
    brandId: zod_1.z.string().uuid('Brand ID deve essere un UUID valido'),
    /** Informazioni del file */
    file: zod_1.z.object({
        /** Nome originale del file */
        filename: zod_1.z.string().min(1, 'Nome file obbligatorio'),
        /** MIME type del file */
        mimetype: zod_1.z.string().min(1, 'MIME type obbligatorio'),
        /** Dimensione del file in bytes */
        size: zod_1.z.number().int().positive('Dimensione file deve essere positiva'),
    }),
});
/**
 * Normalizza il codice brand per consistency
 * - Trimma spazi bianchi
 * - Converte in maiuscolo
 * - Rimuove caratteri non validi (mantiene solo A-Z, 0-9, _, -)
 *
 * @param code - Codice brand da normalizzare
 * @returns Codice normalizzato
 */
function normalizeCode(code) {
    return code
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_ -]/g, '');
}
//# sourceMappingURL=brand.js.map