"use strict";
/**
 * Schema Zod per configurazione Microsoft NAV (SQL Server)
 * Centralizzato in @luke/core per riuso tra API e frontend
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.navConfigResponseSchema = exports.navConfigSchema = void 0;
const zod_1 = require("zod");
/**
 * Schema per configurazione NAV (input per saveConfig)
 */
exports.navConfigSchema = zod_1.z.object({
    host: zod_1.z.string().min(1, 'Host richiesto'),
    port: zod_1.z.number().int().min(1).max(65535),
    database: zod_1.z.string().min(1, 'Database richiesto'),
    user: zod_1.z.string().min(1, 'Utente richiesto'),
    password: zod_1.z.string().optional(),
    company: zod_1.z.string().min(1, 'Company richiesto'),
    /** Connessione SQL Server in sola lettura (ApplicationIntent=ReadOnly). */
    readOnly: zod_1.z.boolean(),
    /** Abilita/disabilita globalmente la sincronizzazione NAV (scheduler + sync manuale). */
    syncEnabled: zod_1.z.boolean(),
});
/**
 * Schema per risposta getNavConfig (password omessa, sostituita da flag)
 */
exports.navConfigResponseSchema = zod_1.z.object({
    host: zod_1.z.string(),
    port: zod_1.z.number(),
    database: zod_1.z.string(),
    user: zod_1.z.string(),
    hasPassword: zod_1.z.boolean(),
    company: zod_1.z.string(),
    readOnly: zod_1.z.boolean(),
});
//# sourceMappingURL=nav.js.map