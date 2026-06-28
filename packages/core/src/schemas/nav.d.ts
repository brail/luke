/**
 * Schema Zod per configurazione Microsoft NAV (SQL Server)
 * Centralizzato in @luke/core per riuso tra API e frontend
 */
import { z } from 'zod';
/**
 * Schema per configurazione NAV (input per saveConfig)
 */
export declare const navConfigSchema: z.ZodObject<{
    host: z.ZodString;
    port: z.ZodNumber;
    database: z.ZodString;
    user: z.ZodString;
    password: z.ZodOptional<z.ZodString>;
    company: z.ZodString;
    readOnly: z.ZodBoolean;
    syncEnabled: z.ZodBoolean;
}, z.core.$strip>;
/**
 * Schema per risposta getNavConfig (password omessa, sostituita da flag)
 */
export declare const navConfigResponseSchema: z.ZodObject<{
    host: z.ZodString;
    port: z.ZodNumber;
    database: z.ZodString;
    user: z.ZodString;
    hasPassword: z.ZodBoolean;
    company: z.ZodString;
    readOnly: z.ZodBoolean;
}, z.core.$strip>;
export type NavConfigInput = z.infer<typeof navConfigSchema>;
export type NavConfigResponse = z.infer<typeof navConfigResponseSchema>;
//# sourceMappingURL=nav.d.ts.map