import { z } from 'zod';

/**
 * Schema Zod per il modello AppConfig
 * Definisce la struttura di una configurazione dell'applicazione
 */
export const AppConfigSchema = z.object({
  /** Chiave identificativa della configurazione */
  key: z.string().min(1),

  /** Valore della configurazione (oggetto serializzabile generico) */
  value: z.unknown(),

  /** Versione della configurazione per gestire aggiornamenti */
  version: z.number().int().positive(),

  /** Data di creazione della configurazione */
  createdAt: z.date(),

  /** Data dell'ultimo aggiornamento */
  updatedAt: z.date(),
});

/**
 * Tipo TypeScript inferito dallo schema AppConfig
 */
export type AppConfig = z.infer<typeof AppConfigSchema>;
