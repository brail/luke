import type { PrismaClient } from '@prisma/client';

export interface NavDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  company: string;
  /**
   * Imposta ApplicationIntent=ReadOnly sulla connessione mssql.
   * Utile con SQL Server Availability Group (legge dalla replica secondaria).
   */
  readOnly: boolean;
}

/**
 * Firma compatibile con getConfig() di apps/api/src/lib/configManager.ts.
 * Passare la funzione dall'esterno per evitare dipendenze da apps/api.
 */
export type GetConfigFn = (
  prisma: PrismaClient,
  key: string,
  decrypt: boolean,
) => Promise<string | null>;

/**
 * Sanitizza il nome della company NAV per uso sicuro nel table name SQL Server.
 * I table name non sono parametrizzabili in MSSQL → bracket-escaping manuale.
 * Lancia se il nome contiene caratteri non ammessi.
 */
export function sanitizeCompany(company: string): string {
  if (!/^[A-Za-z0-9 _\-.]+$/.test(company)) {
    throw new Error(
      `NAV company name non valido: "${company}". Solo lettere, numeri, spazi e i caratteri _ - . sono ammessi.`,
    );
  }
  // Bracket-escaping: ] → ]] per evitare injection via SQL Server quoted identifiers
  return company.replace(/\]/g, ']]');
}

/**
 * Legge la configurazione NAV da AppConfig tramite la funzione getConfig iniettata.
 * La password viene decifrata (decrypt: true) — le altre chiavi sono in chiaro.
 */
export async function getNavDbConfig(
  prisma: PrismaClient,
  getConfig: GetConfigFn,
): Promise<NavDbConfig> {
  const [host, port, database, user, password, company, readOnly] =
    await Promise.all([
      getConfig(prisma, 'integrations.nav.host', false),
      getConfig(prisma, 'integrations.nav.port', false),
      getConfig(prisma, 'integrations.nav.database', false),
      getConfig(prisma, 'integrations.nav.user', false),
      getConfig(prisma, 'integrations.nav.password', true),
      getConfig(prisma, 'integrations.nav.company', false),
      getConfig(prisma, 'integrations.nav.readOnly', false),
    ]);

  if (!host || !port || !database || !user || !password || !company) {
    throw new Error(
      'Configurazione NAV incompleta. Verifica le chiavi integrations.nav.* in AppConfig.',
    );
  }

  return {
    host,
    port: parseInt(port, 10),
    database,
    user,
    password,
    company,
    readOnly: readOnly !== 'false',
  };
}
