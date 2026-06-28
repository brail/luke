"use strict";
/**
 * Schema Zod per configurazione Mail SMTP
 * Centralizzato in @luke/core per riuso tra API e frontend
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mailOperationResponseSchema = exports.mailTestResponseSchema = exports.mailTestSchema = exports.mailSmtpConfigResponseSchema = exports.mailSmtpConfigSchema = void 0;
const zod_1 = require("zod");
/**
 * Schema per configurazione SMTP (input per saveConfig)
 */
exports.mailSmtpConfigSchema = zod_1.z.object({
    host: zod_1.z.string().min(1, 'Host SMTP richiesto'),
    port: zod_1.z.number().int().positive(),
    secure: zod_1.z.boolean(),
    user: zod_1.z.string().min(1, 'Username richiesto'),
    pass: zod_1.z.string().optional().or(zod_1.z.literal('')),
    from: zod_1.z
        .string()
        .min(1, 'Mittente richiesto')
        .refine(v => /^[^<>]+<[^\s@]+@[^\s@]+\.[^\s@]+>$/.test(v) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Formato valido: email@dominio.com oppure Nome <email@dominio.com>'),
    baseUrl: zod_1.z.string().url('URL valido richiesto'),
});
/**
 * Schema per risposta getMailConfig (output con dati sensibili omessi)
 */
exports.mailSmtpConfigResponseSchema = zod_1.z.object({
    host: zod_1.z.string(),
    port: zod_1.z.number(),
    secure: zod_1.z.boolean(),
    user: zod_1.z.string(),
    hasPassword: zod_1.z.boolean(),
    from: zod_1.z.string(),
    baseUrl: zod_1.z.string(),
});
/**
 * Schema per test email
 */
exports.mailTestSchema = zod_1.z.object({
    testEmail: zod_1.z.string().email().optional(),
});
/**
 * Schema per risposta test email
 */
exports.mailTestResponseSchema = zod_1.z.object({
    success: zod_1.z.boolean(),
    message: zod_1.z.string(),
    sentTo: zod_1.z.string().optional(),
});
/**
 * Schema per risposta operazioni mail
 */
exports.mailOperationResponseSchema = zod_1.z.object({
    success: zod_1.z.boolean(),
    message: zod_1.z.string(),
});
//# sourceMappingURL=mail.js.map