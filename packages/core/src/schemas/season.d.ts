/**
 * Schema Zod per Season
 * Definisce validazione e tipi per operazioni CRUD Season
 */
import { z } from 'zod';
export declare const SeasonInputSchema: z.ZodObject<{
    code: z.ZodString;
    year: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    name: z.ZodString;
    navSeasonId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    isActive: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const SeasonIdSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export declare const SeasonListInputSchema: z.ZodObject<{
    isActive: z.ZodOptional<z.ZodBoolean>;
    search: z.ZodOptional<z.ZodString>;
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export declare const SeasonUpdateInputSchema: z.ZodObject<{
    id: z.ZodString;
    data: z.ZodObject<{
        code: z.ZodOptional<z.ZodString>;
        year: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodNumber>>>;
        name: z.ZodOptional<z.ZodString>;
        navSeasonId: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
        isActive: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    }, z.core.$strip>;
}, z.core.$strip>;
/** Schema di output completo per Season (response dal server) */
export declare const SeasonSchema: z.ZodObject<{
    id: z.ZodString;
    code: z.ZodString;
    year: z.ZodNullable<z.ZodNumber>;
    name: z.ZodString;
    navSeasonId: z.ZodNullable<z.ZodString>;
    isActive: z.ZodBoolean;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
}, z.core.$strip>;
export type SeasonInput = z.infer<typeof SeasonInputSchema>;
export type SeasonId = z.infer<typeof SeasonIdSchema>;
export type SeasonListInput = z.infer<typeof SeasonListInputSchema>;
export type SeasonUpdateInput = z.infer<typeof SeasonUpdateInputSchema>;
export type Season = z.infer<typeof SeasonSchema>;
//# sourceMappingURL=season.d.ts.map