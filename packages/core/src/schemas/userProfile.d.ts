import { z } from 'zod';
/**
 * Schema Zod per aggiornamento profilo utente
 * Definisce i campi modificabili nel profilo utente
 */
export declare const UserProfileSchema: z.ZodObject<{
    email: z.ZodString;
    firstName: z.ZodString;
    lastName: z.ZodString;
    locale: z.ZodString;
    timezone: z.ZodString;
}, z.core.$strip>;
/**
 * Schema Zod per aggiornamento parziale profilo (solo timezone)
 * Permette di aggiornare solo il timezone senza richiedere tutti i campi
 */
export declare const UpdateTimezoneSchema: z.ZodObject<{
    timezone: z.ZodString;
}, z.core.$strip>;
/**
 * Schema Zod per cambio password
 * Include validazione policy password e conferma
 */
export declare const ChangePasswordSchema: z.ZodObject<{
    currentPassword: z.ZodString;
    newPassword: z.ZodString;
    confirmNewPassword: z.ZodString;
}, z.core.$strip>;
/**
 * Tipo TypeScript per input aggiornamento profilo
 */
export type UserProfileInput = z.infer<typeof UserProfileSchema>;
/**
 * Tipo TypeScript per input aggiornamento timezone
 */
export type UpdateTimezoneInput = z.infer<typeof UpdateTimezoneSchema>;
/**
 * Tipo TypeScript per input cambio password
 */
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
//# sourceMappingURL=userProfile.d.ts.map