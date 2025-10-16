/**
 * Config Manager per Luke API
 * Gestisce la cifratura/decifratura dei valori sensibili in AppConfig
 * usando AES-256-GCM con master key da file ~/.luke/secret.key
 */
import type { PrismaClient } from '@prisma/client';
/**
 * Interfaccia per configurazione LDAP
 */
export interface LdapConfig {
    enabled: boolean;
    url: string;
    bindDN: string;
    bindPassword: string;
    searchBase: string;
    searchFilter: string;
    groupSearchBase: string;
    groupSearchFilter: string;
    roleMapping: Record<string, string>;
    strategy: 'local-first' | 'ldap-first' | 'local-only' | 'ldap-only';
}
/**
 * Ottiene la master key per la cifratura
 * Se non esiste, la crea automaticamente
 */
export declare function getMasterKey(): Buffer;
/**
 * Cifra un valore usando AES-256-GCM
 * @param plaintext - Testo da cifrare
 * @returns Stringa nel formato "iv:authTag:ciphertext" (tutto in hex)
 */
export declare function encryptValue(plaintext: string): string;
/**
 * Decifra un valore usando AES-256-GCM
 * @param encrypted - Stringa nel formato "iv:authTag:ciphertext"
 * @returns Testo decifrato
 */
export declare function decryptValue(encrypted: string): string;
/**
 * Salva una configurazione nel database con supporto cifratura
 *
 * @param prisma - Client Prisma
 * @param key - Chiave della configurazione (deve rispettare formato e prefissi ammessi)
 * @param value - Valore da salvare
 * @param encrypt - Se true, cifra il valore con AES-256-GCM prima di salvarlo
 *
 * @example
 * // Salva valore plaintext
 * await saveConfig(prisma, "app.name", "Luke", false);
 *
 * @example
 * // Salva valore cifrato
 * await saveConfig(prisma, "auth.ldap.password", "secret123", true);
 */
export declare function saveConfig(prisma: PrismaClient, key: string, value: string, encrypt?: boolean): Promise<void>;
/**
 * Recupera una configurazione dal database con supporto decifratura
 *
 * **SICUREZZA**: Per motivi di sicurezza, questa funzione dovrebbe essere usata
 * solo per singole chiavi. Per liste multiple, usare `listConfigsPaged`.
 *
 * @param prisma - Client Prisma
 * @param key - Chiave della configurazione
 * @param decrypt - Se true, decifra automaticamente i valori cifrati
 * @returns Valore della configurazione (decifrato se richiesto e cifrato)
 *
 * @example
 * // Recupera valore decifrato
 * const value = await getConfig(prisma, "auth.ldap.password", true);
 *
 * @example
 * // Recupera valore raw (cifrato rimane cifrato)
 * const value = await getConfig(prisma, "auth.ldap.password", false);
 */
export declare function getConfig(prisma: PrismaClient, key: string, decrypt?: boolean): Promise<string | null>;
/**
 * Lista tutte le configurazioni
 * @param prisma - Client Prisma
 * @param decrypt - Se true, decifra i valori cifrati
 * @returns Array di configurazioni
 */
export declare function listConfigs(prisma: PrismaClient, decrypt?: boolean): Promise<Array<{
    key: string;
    value: string;
    isEncrypted: boolean;
}>>;
/**
 * Lista configurazioni con paginazione, filtri e ordinamento
 *
 * **SICUREZZA**: I valori cifrati non vengono mai decrittati in questa funzione.
 * Per valori cifrati, `valuePreview` sarà sempre `null`.
 *
 * @param prisma - Client Prisma
 * @param params - Parametri per filtri, paginazione e ordinamento
 * @param params.q - Ricerca per chiave (case-insensitive)
 * @param params.category - Filtra per categoria (prefisso della chiave)
 * @param params.isEncrypted - Filtra per tipo di cifratura
 * @param params.sortBy - Campo per ordinamento
 * @param params.sortDir - Direzione ordinamento
 * @param params.page - Numero pagina (1-based)
 * @param params.pageSize - Dimensione pagina (5-100)
 * @returns Risultati paginati con metadati
 *
 * @example
 * // Lista base con paginazione
 * const result = await listConfigsPaged(prisma, { page: 1, pageSize: 20 });
 *
 * @example
 * // Ricerca con filtri
 * const result = await listConfigsPaged(prisma, {
 *   q: "ldap",
 *   category: "auth",
 *   isEncrypted: true,
 *   sortBy: "updatedAt",
 *   sortDir: "desc",
 *   page: 1,
 *   pageSize: 50
 * });
 */
export declare function listConfigsPaged(prisma: PrismaClient, params?: {
    q?: string;
    category?: string;
    isEncrypted?: boolean;
    sortBy?: 'key' | 'updatedAt';
    sortDir?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
}): Promise<{
    items: Array<{
        key: string;
        valuePreview: string | null;
        isEncrypted: boolean;
        category: string;
        updatedAt: string;
    }>;
    page: number;
    pageSize: number;
    total: number;
    hasNextPage: boolean;
}>;
/**
 * Elimina una configurazione
 * @param prisma - Client Prisma
 * @param key - Chiave della configurazione da eliminare
 */
export declare function deleteConfig(prisma: PrismaClient, key: string): Promise<void>;
/**
 * Recupera un segreto dal database e lo decifra
 * @param prisma - Client Prisma
 * @param key - Chiave del segreto da recuperare
 * @returns Valore decifrato del segreto
 * @throws Error se la chiave non esiste o non è cifrata
 */
export declare function getSecret(prisma: PrismaClient, key: string): Promise<string>;
/**
 * Recupera la configurazione LDAP completa dal database
 * @param prisma - Client Prisma
 * @returns Configurazione LDAP decifrata e tipizzata
 * @throws Error se le configurazioni non sono complete
 */
export declare function getLdapConfig(prisma: PrismaClient): Promise<LdapConfig>;
//# sourceMappingURL=configManager.d.ts.map