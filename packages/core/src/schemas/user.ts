import { z } from 'zod';

/**
 * Schema Zod per il modello User
 * Definisce la struttura di un utente con validazione dei campi
 */
export const UserSchema = z.object({
  /** ID univoco dell'utente (UUID v4) */
  id: z.string().uuid(),

  /** Email dell'utente (validata come formato email) */
  email: z.string().email(),

  /** Ruolo dell'utente nel sistema */
  role: z.enum(['admin', 'editor', 'viewer']),

  /** Stato di attivazione dell'utente */
  isActive: z.boolean(),

  /** Data di creazione dell'utente */
  createdAt: z.date(),

  /** Data dell'ultimo aggiornamento */
  updatedAt: z.date(),
});

/**
 * Tipo TypeScript inferito dallo schema User
 */
export type User = z.infer<typeof UserSchema>;
