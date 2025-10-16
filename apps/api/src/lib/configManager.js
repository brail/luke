/**
 * Config Manager per Luke API
 * Gestisce la cifratura/decifratura dei valori sensibili in AppConfig
 * usando AES-256-GCM con master key da file ~/.luke/secret.key
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
const MASTER_KEY_PATH = join(homedir(), '.luke', 'secret.key');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits
/**
 * Ottiene la master key per la cifratura
 * Se non esiste, la crea automaticamente
 */
export function getMasterKey() {
    const keyDir = join(homedir(), '.luke');
    if (!existsSync(MASTER_KEY_PATH)) {
        // Crea directory se non esiste
        if (!existsSync(keyDir)) {
            mkdirSync(keyDir, { mode: 0o700 });
        }
        // Genera nuova master key
        const masterKey = randomBytes(KEY_LENGTH);
        writeFileSync(MASTER_KEY_PATH, masterKey, { mode: 0o600 });
        console.log(`🔑 Master key creata in: ${MASTER_KEY_PATH}`);
    }
    const keyBuffer = readFileSync(MASTER_KEY_PATH);
    if (keyBuffer.length !== KEY_LENGTH) {
        throw new Error(`Master key deve essere di ${KEY_LENGTH} bytes, trovati ${keyBuffer.length}`);
    }
    return keyBuffer;
}
/**
 * Cifra un valore usando AES-256-GCM
 * @param plaintext - Testo da cifrare
 * @returns Stringa nel formato "iv:authTag:ciphertext" (tutto in hex)
 */
export function encryptValue(plaintext) {
    const masterKey = getMasterKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, masterKey, iv);
    let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    // Formato: iv:authTag:ciphertext (tutto in hex)
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
}
/**
 * Decifra un valore usando AES-256-GCM
 * @param encrypted - Stringa nel formato "iv:authTag:ciphertext"
 * @returns Testo decifrato
 */
export function decryptValue(encrypted) {
    const masterKey = getMasterKey();
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
        throw new Error('Formato encrypted non valido. Atteso: iv:authTag:ciphertext');
    }
    const [ivHex, authTagHex, ciphertext] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
    decipher.setAuthTag(authTag);
    let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');
    return plaintext;
}
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
export async function saveConfig(prisma, key, value, encrypt = false) {
    const finalValue = encrypt ? encryptValue(value) : value;
    await prisma.appConfig.upsert({
        where: { key },
        update: {
            value: finalValue,
            isEncrypted: encrypt,
            updatedAt: new Date(),
        },
        create: {
            key,
            value: finalValue,
            isEncrypted: encrypt,
        },
    });
}
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
export async function getConfig(prisma, key, decrypt = true) {
    const config = await prisma.appConfig.findUnique({
        where: { key },
    });
    if (!config) {
        return null;
    }
    if (config.isEncrypted && decrypt) {
        try {
            return decryptValue(config.value);
        }
        catch (error) {
            console.error(`Errore decifratura config ${key}:`, error);
            throw new Error(`Impossibile decifrare configurazione: ${key}`);
        }
    }
    return config.value;
}
/**
 * Lista tutte le configurazioni
 * @param prisma - Client Prisma
 * @param decrypt - Se true, decifra i valori cifrati
 * @returns Array di configurazioni
 */
export async function listConfigs(prisma, decrypt = true) {
    const configs = await prisma.appConfig.findMany({
        orderBy: { key: 'asc' },
    });
    return configs.map(config => ({
        key: config.key,
        value: config.isEncrypted && decrypt
            ? (() => {
                try {
                    return decryptValue(config.value);
                }
                catch (error) {
                    console.error(`Errore decifratura config ${config.key}:`, error);
                    return '[ERRORE DECIFRATURA]';
                }
            })()
            : config.value,
        isEncrypted: config.isEncrypted,
    }));
}
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
export async function listConfigsPaged(prisma, params = {}) {
    const { q, category, isEncrypted, sortBy = 'key', sortDir = 'asc', page = 1, pageSize = 20, } = params;
    // Costruisci where clause per filtri
    const where = {};
    // Gestisci filtri per key
    if (q && category) {
        // Se abbiamo sia ricerca che categoria, combina i filtri
        where.AND = [
            {
                key: {
                    contains: q,
                    // SQLite non supporta mode: 'insensitive'
                },
            },
            {
                key: {
                    startsWith: `${category}.`,
                },
            },
        ];
    }
    else if (q) {
        where.key = {
            contains: q,
            // SQLite non supporta mode: 'insensitive'
        };
    }
    else if (category) {
        where.key = {
            startsWith: `${category}.`,
        };
    }
    if (typeof isEncrypted === 'boolean') {
        where.isEncrypted = isEncrypted;
    }
    // Calcola skip per paginazione
    const skip = (page - 1) * pageSize;
    // Crea where clause per count (senza mode: 'insensitive' che non è supportato)
    const countWhere = {};
    if (q && category) {
        countWhere.AND = [
            {
                key: {
                    contains: q,
                    // Rimuovi mode per count()
                },
            },
            {
                key: {
                    startsWith: `${category}.`,
                },
            },
        ];
    }
    else if (q) {
        countWhere.key = {
            contains: q,
            // Rimuovi mode per count()
        };
    }
    else if (category) {
        countWhere.key = {
            startsWith: `${category}.`,
        };
    }
    if (typeof isEncrypted === 'boolean') {
        countWhere.isEncrypted = isEncrypted;
    }
    // Esegui query parallele per items e total
    const [itemsRaw, total] = await Promise.all([
        prisma.appConfig.findMany({
            where,
            orderBy: { [sortBy]: sortDir },
            skip,
            take: pageSize,
            select: {
                key: true,
                value: true,
                isEncrypted: true,
                updatedAt: true,
            },
        }),
        prisma.appConfig.count({ where: countWhere }),
    ]);
    // Processa i risultati
    const items = itemsRaw.map(item => ({
        key: item.key,
        category: item.key.split('.')[0] || 'misc',
        isEncrypted: item.isEncrypted,
        valuePreview: item.isEncrypted
            ? null
            : item.value.length > 80
                ? item.value.slice(0, 77) + '…'
                : item.value,
        updatedAt: item.updatedAt.toISOString(),
    }));
    return {
        items,
        page,
        pageSize,
        total,
        hasNextPage: skip + pageSize < total,
    };
}
/**
 * Elimina una configurazione
 * @param prisma - Client Prisma
 * @param key - Chiave della configurazione da eliminare
 */
export async function deleteConfig(prisma, key) {
    await prisma.appConfig.delete({
        where: { key },
    });
}
/**
 * Recupera un segreto dal database e lo decifra
 * @param prisma - Client Prisma
 * @param key - Chiave del segreto da recuperare
 * @returns Valore decifrato del segreto
 * @throws Error se la chiave non esiste o non è cifrata
 */
export async function getSecret(prisma, key) {
    const config = await prisma.appConfig.findUnique({
        where: { key },
    });
    if (!config) {
        throw new Error(`Segreto '${key}' non trovato in AppConfig`);
    }
    if (!config.isEncrypted) {
        throw new Error(`La configurazione '${key}' non è cifrata. Usa getConfig() per valori non cifrati.`);
    }
    try {
        return decryptValue(config.value);
    }
    catch (error) {
        console.error(`Errore decifratura segreto ${key}:`, error);
        throw new Error(`Impossibile decifrare segreto: ${key}`);
    }
}
/**
 * Recupera la configurazione LDAP completa dal database
 * @param prisma - Client Prisma
 * @returns Configurazione LDAP decifrata e tipizzata
 * @throws Error se le configurazioni non sono complete
 */
export async function getLdapConfig(prisma) {
    const configKeys = [
        'auth.ldap.enabled',
        'auth.ldap.url',
        'auth.ldap.bindDN',
        'auth.ldap.bindPassword',
        'auth.ldap.searchBase',
        'auth.ldap.searchFilter',
        'auth.ldap.groupSearchBase',
        'auth.ldap.groupSearchFilter',
        'auth.ldap.roleMapping',
        'auth.strategy',
    ];
    const configs = await prisma.appConfig.findMany({
        where: {
            key: {
                in: configKeys,
            },
        },
    });
    // Verifica che tutte le configurazioni esistano
    const foundKeys = configs.map(c => c.key);
    const missingKeys = configKeys.filter(key => !foundKeys.includes(key));
    if (missingKeys.length > 0) {
        throw new Error(`Configurazioni LDAP mancanti: ${missingKeys.join(', ')}`);
    }
    // Crea mappa per accesso rapido
    const configMap = new Map(configs.map(c => [c.key, c]));
    // Recupera e decifra i valori
    const enabled = configMap.get('auth.ldap.enabled')?.value === 'true';
    const url = configMap.get('auth.ldap.url')?.isEncrypted
        ? decryptValue(configMap.get('auth.ldap.url').value)
        : configMap.get('auth.ldap.url')?.value || '';
    const bindDN = configMap.get('auth.ldap.bindDN')?.isEncrypted
        ? decryptValue(configMap.get('auth.ldap.bindDN').value)
        : configMap.get('auth.ldap.bindDN')?.value || '';
    const bindPassword = configMap.get('auth.ldap.bindPassword')?.isEncrypted
        ? decryptValue(configMap.get('auth.ldap.bindPassword').value)
        : configMap.get('auth.ldap.bindPassword')?.value || '';
    const searchBase = configMap.get('auth.ldap.searchBase')?.isEncrypted
        ? decryptValue(configMap.get('auth.ldap.searchBase').value)
        : configMap.get('auth.ldap.searchBase')?.value || '';
    const searchFilter = configMap.get('auth.ldap.searchFilter')?.isEncrypted
        ? decryptValue(configMap.get('auth.ldap.searchFilter').value)
        : configMap.get('auth.ldap.searchFilter')?.value || '';
    const groupSearchBase = configMap.get('auth.ldap.groupSearchBase')
        ?.isEncrypted
        ? decryptValue(configMap.get('auth.ldap.groupSearchBase').value)
        : configMap.get('auth.ldap.groupSearchBase')?.value || '';
    const groupSearchFilter = configMap.get('auth.ldap.groupSearchFilter')
        ?.isEncrypted
        ? decryptValue(configMap.get('auth.ldap.groupSearchFilter').value)
        : configMap.get('auth.ldap.groupSearchFilter')?.value || '';
    const roleMappingStr = configMap.get('auth.ldap.roleMapping')?.isEncrypted
        ? decryptValue(configMap.get('auth.ldap.roleMapping').value)
        : configMap.get('auth.ldap.roleMapping')?.value || '{}';
    const strategy = configMap.get('auth.strategy')?.value ||
        'local-first';
    // Parsa roleMapping da JSON
    let roleMapping;
    try {
        roleMapping = JSON.parse(roleMappingStr);
    }
    catch (error) {
        console.warn('Errore parsing roleMapping, usando mapping vuoto:', error);
        roleMapping = {};
    }
    return {
        enabled,
        url,
        bindDN,
        bindPassword,
        searchBase,
        searchFilter,
        groupSearchBase,
        groupSearchFilter,
        roleMapping,
        strategy,
    };
}
//# sourceMappingURL=configManager.js.map