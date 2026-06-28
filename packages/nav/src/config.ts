import type { PrismaClient } from '@prisma/client';

/**
 * Connection parameters for the NAV SQL Server database.
 */
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
 * Signature compatible with `getConfig()` from `apps/api/src/lib/configManager.ts`.
 * Injected from the outside so this package does not depend on `apps/api`.
 */
export type GetConfigFn = (
  prisma: PrismaClient,
  key: string,
  decrypt: boolean,
) => Promise<string | null>;

/**
 * Sanitizes the NAV company name for safe use in SQL Server table identifiers.
 * Table names cannot be parameterized in MSSQL, so bracket-escaping is applied manually.
 *
 * @throws {Error} When the company name contains characters outside `[A-Za-z0-9 _\-.]`.
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
 * Reads all NAV connection parameters from AppConfig via the injected `getConfig` function.
 * The password is decrypted (`decrypt: true`); all other keys are read as plain text.
 *
 * @throws {Error} When any required key (`host`, `port`, `database`, `user`, `password`, `company`) is missing.
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
