"use strict";
/**
 * Schema Zod per autenticazione e email transazionali
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestEmailVerificationAdminSchema = exports.ConfirmEmailVerificationSchema = exports.RequestEmailVerificationSchema = exports.ConfirmPasswordResetSchema = exports.RequestPasswordResetSchema = void 0;
const zod_1 = require("zod");
/**
 * Schema per richiesta reset password
 */
exports.RequestPasswordResetSchema = zod_1.z.object({
    email: zod_1.z
        .string()
        .min(1, 'Email richiesta')
        .email('Email non valida')
        .toLowerCase()
        .trim(),
});
/**
 * Schema per conferma reset password
 * Il token deve essere di 64 caratteri hex (32 byte)
 * La password sarà validata contro la password policy al momento della conferma
 */
exports.ConfirmPasswordResetSchema = zod_1.z.object({
    token: zod_1.z
        .string()
        .min(64, 'Token non valido')
        .max(64, 'Token non valido')
        .regex(/^[a-f0-9]{64}$/, 'Token deve essere una stringa hex di 64 caratteri'),
    newPassword: zod_1.z.string().min(1, 'Password richiesta'),
});
/**
 * Schema per richiesta verifica email
 */
exports.RequestEmailVerificationSchema = zod_1.z.object({
    email: zod_1.z
        .string()
        .min(1, 'Email richiesta')
        .email('Email non valida')
        .toLowerCase()
        .trim(),
});
/**
 * Schema per conferma verifica email
 */
exports.ConfirmEmailVerificationSchema = zod_1.z.object({
    token: zod_1.z
        .string()
        .min(64, 'Token non valido')
        .max(64, 'Token non valido')
        .regex(/^[a-f0-9]{64}$/, 'Token deve essere una stringa hex di 64 caratteri'),
});
/**
 * Schema per richiesta verifica email da admin (by userId)
 */
exports.RequestEmailVerificationAdminSchema = zod_1.z.object({
    userId: zod_1.z.string().uuid('ID utente non valido'),
});
//# sourceMappingURL=auth.js.map