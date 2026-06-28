"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateUserInputSchema = exports.CreateUserInputSchema = exports.UserSchema = void 0;
const zod_1 = require("zod");
/**
 * Schema Zod per il modello User
 * Definisce la struttura di un utente con validazione dei campi
 */
exports.UserSchema = zod_1.z.object({
    /** ID univoco dell'utente (UUID v4) */
    id: zod_1.z.string().uuid(),
    /** Email dell'utente (validata come formato email) */
    email: zod_1.z.string().email(),
    /** Username dell'utente */
    username: zod_1.z.string(),
    /** Nome dell'utente */
    firstName: zod_1.z.string().default(''),
    /** Cognome dell'utente */
    lastName: zod_1.z.string().default(''),
    /** Ruolo dell'utente nel sistema */
    role: zod_1.z.enum(['admin', 'editor', 'viewer']),
    /** Stato di attivazione dell'utente */
    isActive: zod_1.z.boolean(),
    /** Data di creazione dell'utente */
    createdAt: zod_1.z.date(),
    /** Data dell'ultimo aggiornamento */
    updatedAt: zod_1.z.date(),
});
/**
 * Schema per creazione utente
 */
exports.CreateUserInputSchema = zod_1.z.object({
    email: zod_1.z.string().email('Email non valida'),
    username: zod_1.z.string().min(3, 'Username deve essere di almeno 3 caratteri'),
    firstName: zod_1.z.string().optional().or(zod_1.z.literal('')),
    lastName: zod_1.z.string().optional().or(zod_1.z.literal('')),
    password: zod_1.z.string().min(12, 'Password deve essere di almeno 12 caratteri'),
    role: zod_1.z.enum(['admin', 'editor', 'viewer']),
});
/**
 * Schema per aggiornamento utente
 */
exports.UpdateUserInputSchema = zod_1.z.object({
    id: zod_1.z.string().uuid('ID utente non valido'),
    email: zod_1.z.string().email('Email non valida').optional(),
    username: zod_1.z
        .string()
        .min(3, 'Username deve essere di almeno 3 caratteri')
        .optional(),
    firstName: zod_1.z.string().optional().or(zod_1.z.literal('')),
    lastName: zod_1.z.string().optional().or(zod_1.z.literal('')),
    role: zod_1.z.enum(['admin', 'editor', 'viewer']).optional(),
    isActive: zod_1.z.boolean().optional(),
});
//# sourceMappingURL=user.js.map