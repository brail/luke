/**
 * Config Manager per Luke API
 * Gestisce la cifratura/decifratura dei valori sensibili in AppConfig
 * usando AES-256-GCM con master key da file ~/.luke/secret.key
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
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

const MASTER_KEY_PATH = join(homedir(), '.luke', 'secret.key');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits

/**
 * Ottiene la master key per la cifratura
 * Se non esiste, la crea automaticamente
 */
export function getMasterKey(): Buffer {
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
    throw new Error(
      `Master key deve essere di ${KEY_LENGTH} bytes, trovati ${keyBuffer.length}`
    );
  }

  return keyBuffer;
}

/**
 * Cifra un valore usando AES-256-GCM
 * @param plaintext - Testo da cifrare
 * @returns Stringa nel formato "iv:authTag:ciphertext" (tutto in hex)
 */
export function encryptValue(plaintext: string): string {
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
export function decryptValue(encrypted: string): string {
  const masterKey = getMasterKey();
  const parts = encrypted.split(':');

  if (parts.length !== 3) {
    throw new Error(
      'Formato encrypted non valido. Atteso: iv:authTag:ciphertext'
    );
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
 * Salva una configurazione nel database
 * @param prisma - Client Prisma
 * @param key - Chiave della configurazione
 * @param value - Valore da salvare
 * @param encrypt - Se true, cifra il valore prima di salvarlo
 */
export async function saveConfig(
  prisma: PrismaClient,
  key: string,
  value: string,
  encrypt: boolean = false
): Promise<void> {
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
 * Recupera una configurazione dal database
 * @param prisma - Client Prisma
 * @param key - Chiave della configurazione
 * @param decrypt - Se true, decifra il valore se è cifrato
 * @returns Valore della configurazione (decifrato se richiesto)
 */
export async function getConfig(
  prisma: PrismaClient,
  key: string,
  decrypt: boolean = true
): Promise<string | null> {
  const config = await prisma.appConfig.findUnique({
    where: { key },
  });

  if (!config) {
    return null;
  }

  if (config.isEncrypted && decrypt) {
    try {
      return decryptValue(config.value);
    } catch (error) {
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
export async function listConfigs(
  prisma: PrismaClient,
  decrypt: boolean = true
): Promise<Array<{ key: string; value: string; isEncrypted: boolean }>> {
  const configs = await prisma.appConfig.findMany({
    orderBy: { key: 'asc' },
  });

  return configs.map(config => ({
    key: config.key,
    value:
      config.isEncrypted && decrypt
        ? (() => {
            try {
              return decryptValue(config.value);
            } catch (error) {
              console.error(`Errore decifratura config ${config.key}:`, error);
              return '[ERRORE DECIFRATURA]';
            }
          })()
        : config.value,
    isEncrypted: config.isEncrypted,
  }));
}

/**
 * Elimina una configurazione
 * @param prisma - Client Prisma
 * @param key - Chiave della configurazione da eliminare
 */
export async function deleteConfig(
  prisma: PrismaClient,
  key: string
): Promise<void> {
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
export async function getSecret(
  prisma: PrismaClient,
  key: string
): Promise<string> {
  const config = await prisma.appConfig.findUnique({
    where: { key },
  });

  if (!config) {
    throw new Error(`Segreto '${key}' non trovato in AppConfig`);
  }

  if (!config.isEncrypted) {
    throw new Error(
      `La configurazione '${key}' non è cifrata. Usa getConfig() per valori non cifrati.`
    );
  }

  try {
    return decryptValue(config.value);
  } catch (error) {
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
export async function getLdapConfig(prisma: PrismaClient): Promise<LdapConfig> {
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
    ? decryptValue(configMap.get('auth.ldap.url')!.value)
    : configMap.get('auth.ldap.url')?.value || '';

  const bindDN = configMap.get('auth.ldap.bindDN')?.isEncrypted
    ? decryptValue(configMap.get('auth.ldap.bindDN')!.value)
    : configMap.get('auth.ldap.bindDN')?.value || '';

  const bindPassword = configMap.get('auth.ldap.bindPassword')?.isEncrypted
    ? decryptValue(configMap.get('auth.ldap.bindPassword')!.value)
    : configMap.get('auth.ldap.bindPassword')?.value || '';

  const searchBase = configMap.get('auth.ldap.searchBase')?.isEncrypted
    ? decryptValue(configMap.get('auth.ldap.searchBase')!.value)
    : configMap.get('auth.ldap.searchBase')?.value || '';

  const searchFilter = configMap.get('auth.ldap.searchFilter')?.isEncrypted
    ? decryptValue(configMap.get('auth.ldap.searchFilter')!.value)
    : configMap.get('auth.ldap.searchFilter')?.value || '';

  const groupSearchBase = configMap.get('auth.ldap.groupSearchBase')
    ?.isEncrypted
    ? decryptValue(configMap.get('auth.ldap.groupSearchBase')!.value)
    : configMap.get('auth.ldap.groupSearchBase')?.value || '';

  const groupSearchFilter = configMap.get('auth.ldap.groupSearchFilter')
    ?.isEncrypted
    ? decryptValue(configMap.get('auth.ldap.groupSearchFilter')!.value)
    : configMap.get('auth.ldap.groupSearchFilter')?.value || '';

  const roleMappingStr = configMap.get('auth.ldap.roleMapping')?.isEncrypted
    ? decryptValue(configMap.get('auth.ldap.roleMapping')!.value)
    : configMap.get('auth.ldap.roleMapping')?.value || '{}';

  const strategy =
    (configMap.get('auth.strategy')?.value as LdapConfig['strategy']) ||
    'local-first';

  // Parsa roleMapping da JSON
  let roleMapping: Record<string, string>;
  try {
    roleMapping = JSON.parse(roleMappingStr);
  } catch (error) {
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
