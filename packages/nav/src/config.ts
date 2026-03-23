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
   * Non ha effetto sulla logica di sync: se vuoi disabilitare il sync usa syncEnabled.
   */
  readOnly: boolean;
  /**
   * Abilita la sincronizzazione NAV → DB locale.
   * Se false, runNavSync ritorna immediatamente senza toccare né NAV né Postgres.
   */
  syncEnabled: boolean;
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
 * Legge la configurazione NAV da AppConfig tramite la funzione getConfig iniettata.
 * La password viene decifrata (decrypt: true) — le altre chiavi sono in chiaro.
 */
export async function getNavDbConfig(
  prisma: PrismaClient,
  getConfig: GetConfigFn,
): Promise<NavDbConfig> {
  const [host, port, database, user, password, company, readOnly, syncEnabled] =
    await Promise.all([
      getConfig(prisma, 'integrations.nav.host', false),
      getConfig(prisma, 'integrations.nav.port', false),
      getConfig(prisma, 'integrations.nav.database', false),
      getConfig(prisma, 'integrations.nav.user', false),
      getConfig(prisma, 'integrations.nav.password', true),
      getConfig(prisma, 'integrations.nav.company', false),
      getConfig(prisma, 'integrations.nav.readOnly', false),
      getConfig(prisma, 'integrations.nav.syncEnabled', false),
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
    syncEnabled: syncEnabled === 'true',
  };
}
