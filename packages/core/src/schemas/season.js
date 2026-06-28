"use strict";
/**
 * Schema Zod per Season
 * Definisce validazione e tipi per operazioni CRUD Season
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeasonSchema = exports.SeasonUpdateInputSchema = exports.SeasonListInputSchema = exports.SeasonIdSchema = exports.SeasonInputSchema = void 0;
const zod_1 = require("zod");
exports.SeasonInputSchema = zod_1.z.object({
    code: zod_1.z
        .string()
        .min(1, 'Codice obbligatorio')
        .max(10, 'Max 10 caratteri')
        .regex(/^[A-Za-z0-9_-]+$/, 'Solo lettere, numeri, _ e -'),
    /** Anno (opzionale, descrittivo) */
    year: zod_1.z
        .number()
        .int('Anno deve essere intero')
        .min(2000, 'Anno non valido')
        .max(2100, 'Anno non valido')
        .optional()
        .nullable(),
    name: zod_1.z
        .string()
        .min(1, 'Nome obbligatorio')
        .max(128, 'Max 128 caratteri')
        .trim(),
    /** Codice NAV collegato (opzionale) */
    navSeasonId: zod_1.z.string().max(10).optional().nullable(),
    isActive: zod_1.z.boolean().default(true),
});
exports.SeasonIdSchema = zod_1.z.object({
    id: zod_1.z.string().uuid('ID season non valido'),
});
exports.SeasonListInputSchema = zod_1.z.object({
    isActive: zod_1.z.boolean().optional(),
    search: zod_1.z.string().optional(),
    cursor: zod_1.z.string().uuid().optional(),
    limit: zod_1.z.number().min(1).max(100).default(50),
});
exports.SeasonUpdateInputSchema = zod_1.z.object({
    id: zod_1.z.string().uuid('ID season non valido'),
    data: exports.SeasonInputSchema.partial(),
});
/** Schema di output completo per Season (response dal server) */
exports.SeasonSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    code: zod_1.z.string(),
    year: zod_1.z.number().nullable(),
    name: zod_1.z.string(),
    navSeasonId: zod_1.z.string().nullable(),
    isActive: zod_1.z.boolean(),
    createdAt: zod_1.z.date(),
    updatedAt: zod_1.z.date(),
});
//# sourceMappingURL=season.js.map