/**
 * Schema Zod per configurazione Mail SMTP
 * Centralizzato in @luke/core per riuso tra API e frontend
 */
import { z } from 'zod';
/**
 * Schema per configurazione SMTP (input per saveConfig)
 */
export declare const mailSmtpConfigSchema: z.ZodObject<{
    host: z.ZodString;
    port: z.ZodNumber;
    secure: z.ZodBoolean;
    user: z.ZodString;
    pass: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
    from: z.ZodString;
    baseUrl: z.ZodString;
}, z.core.$strip>;
/**
 * Schema per risposta getMailConfig (output con dati sensibili omessi)
 */
export declare const mailSmtpConfigResponseSchema: z.ZodObject<{
    host: z.ZodString;
    port: z.ZodNumber;
    secure: z.ZodBoolean;
    user: z.ZodString;
    hasPassword: z.ZodBoolean;
    from: z.ZodString;
    baseUrl: z.ZodString;
}, z.core.$strip>;
/**
 * Schema per test email
 */
export declare const mailTestSchema: z.ZodObject<{
    testEmail: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * Schema per risposta test email
 */
export declare const mailTestResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    message: z.ZodString;
    sentTo: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * Schema per risposta operazioni mail
 */
export declare const mailOperationResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    message: z.ZodString;
}, z.core.$strip>;
export type MailSmtpConfigInput = z.infer<typeof mailSmtpConfigSchema>;
export type MailSmtpConfigResponse = z.infer<typeof mailSmtpConfigResponseSchema>;
export type MailTestInput = z.infer<typeof mailTestSchema>;
export type MailTestResponse = z.infer<typeof mailTestResponseSchema>;
export type MailOperationResponse = z.infer<typeof mailOperationResponseSchema>;
//# sourceMappingURL=mail.d.ts.map