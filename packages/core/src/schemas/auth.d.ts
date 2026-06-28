/**
 * Schema Zod per autenticazione e email transazionali
 */
import { z } from 'zod';
/**
 * Schema per richiesta reset password
 */
export declare const RequestPasswordResetSchema: z.ZodObject<{
    email: z.ZodString;
}, z.core.$strip>;
/**
 * Schema per conferma reset password
 * Il token deve essere di 64 caratteri hex (32 byte)
 * La password sarà validata contro la password policy al momento della conferma
 */
export declare const ConfirmPasswordResetSchema: z.ZodObject<{
    token: z.ZodString;
    newPassword: z.ZodString;
}, z.core.$strip>;
/**
 * Schema per richiesta verifica email
 */
export declare const RequestEmailVerificationSchema: z.ZodObject<{
    email: z.ZodString;
}, z.core.$strip>;
/**
 * Schema per conferma verifica email
 */
export declare const ConfirmEmailVerificationSchema: z.ZodObject<{
    token: z.ZodString;
}, z.core.$strip>;
/**
 * Schema per richiesta verifica email da admin (by userId)
 */
export declare const RequestEmailVerificationAdminSchema: z.ZodObject<{
    userId: z.ZodString;
}, z.core.$strip>;
export type RequestPasswordResetInput = z.infer<typeof RequestPasswordResetSchema>;
export type ConfirmPasswordResetInput = z.infer<typeof ConfirmPasswordResetSchema>;
export type RequestEmailVerificationInput = z.infer<typeof RequestEmailVerificationSchema>;
export type ConfirmEmailVerificationInput = z.infer<typeof ConfirmEmailVerificationSchema>;
export type RequestEmailVerificationAdminInput = z.infer<typeof RequestEmailVerificationAdminSchema>;
//# sourceMappingURL=auth.d.ts.map