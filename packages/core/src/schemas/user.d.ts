import { z } from 'zod';
/**
 * Schema Zod per il modello User
 * Definisce la struttura di un utente con validazione dei campi
 */
export declare const UserSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
    username: z.ZodString;
    firstName: z.ZodDefault<z.ZodString>;
    lastName: z.ZodDefault<z.ZodString>;
    role: z.ZodEnum<{
        admin: "admin";
        editor: "editor";
        viewer: "viewer";
    }>;
    isActive: z.ZodBoolean;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
}, z.core.$strip>;
/**
 * Schema per creazione utente
 */
export declare const CreateUserInputSchema: z.ZodObject<{
    email: z.ZodString;
    username: z.ZodString;
    firstName: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
    lastName: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
    password: z.ZodString;
    role: z.ZodEnum<{
        admin: "admin";
        editor: "editor";
        viewer: "viewer";
    }>;
}, z.core.$strip>;
/**
 * Schema per aggiornamento utente
 */
export declare const UpdateUserInputSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodOptional<z.ZodString>;
    username: z.ZodOptional<z.ZodString>;
    firstName: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
    lastName: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
    role: z.ZodOptional<z.ZodEnum<{
        admin: "admin";
        editor: "editor";
        viewer: "viewer";
    }>>;
    isActive: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
/**
 * Tipo TypeScript inferito dallo schema User
 */
export type User = z.infer<typeof UserSchema>;
/**
 * Tipo TypeScript per input creazione utente
 */
export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;
/**
 * Tipo TypeScript per input aggiornamento utente
 */
export type UpdateUserInput = z.infer<typeof UpdateUserInputSchema>;
/**
 * Campi che possono essere bloccati per provider esterni
 */
export type LockedFields = 'email' | 'username' | 'role' | 'firstName' | 'lastName' | 'password';
//# sourceMappingURL=user.d.ts.map