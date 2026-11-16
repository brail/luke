/**
 * The one application writer of the sign-in strategy and the LDAP switch (#246), keys `saveConfig`
 * and `saveConfigs` refuse (`DEDICATED_WRITERS`) and the generic config router refuses too. The seed
 * and a full restore still write them directly, as operational writers.
 */

import { TRPCError } from '@trpc/server';

import type { AppConfigKey } from '@luke/core';
import type { Prisma, PrismaClient } from '@luke/db';

import {
  acquireAppConfigWriteLock,
  assertValidConfigValues,
  getConfig,
  ldapEnabledFrom,
  writeConfigsTx,
  type ConfigWriteOf,
} from '../lib/configManager';
import { acquireLastAdminLock } from '../lib/lastAdminGuard';

import { countBreakGlassAdmins } from './auth.service';

/** A write `saveAuthConfig` takes: the strategy, the LDAP switch, or an `auth.*` key saved with them. */
export type AuthConfigWrite = ConfigWriteOf<Extract<AppConfigKey, `auth.${string}`>>;

/** The value `key` has once `writes` are applied over what is stored (`null`: absent). */
async function valueAfter(
  tx: Prisma.TransactionClient,
  writes: readonly AuthConfigWrite[],
  key: AppConfigKey
): Promise<string | null> {
  const last = writes.filter(write => write.key === key).at(-1);
  return last ? last.value : getConfig(tx, key);
}

/**
 * Saves the strategy, the LDAP switch and the LDAP settings saved with them as one change, refused
 * when it would leave `ldap-only` without a way in:
 * - `ldap-only` with LDAP off — nobody but the local administrators could sign in;
 * - `ldap-only` written now with no break-glass administrator (`countBreakGlassAdmins`).
 *
 * Read, check and write in one transaction under the last-admin lock, then the AppConfig write lock
 * (`saveSectionsDisabled`'s order): a mutation that can lower the break-glass count takes the first,
 * a verification-policy change the second, so each waits for this or this for it. The count holds at
 * this commit; a later change can still lower it (owner decision 4).
 *
 * @returns For each value write, in order, whether it was stored encrypted.
 * @throws {TRPCError} `BAD_REQUEST` for a value its schema refuses or a refused change; nothing is written.
 */
export async function saveAuthConfig(prisma: PrismaClient, writes: readonly AuthConfigWrite[]): Promise<boolean[]> {
  assertValidConfigValues(writes);
  return prisma.$transaction(async tx => {
    await acquireLastAdminLock(tx);
    await acquireAppConfigWriteLock(tx);

    if ((await valueAfter(tx, writes, 'auth.strategy')) === 'ldap-only') {
      if (!ldapEnabledFrom((await valueAfter(tx, writes, 'auth.ldap.enabled')) ?? undefined)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'La strategia ldap-only richiede LDAP abilitato' });
      }
      const writesStrategy = writes.some(write => write.key === 'auth.strategy');
      if (writesStrategy && (await countBreakGlassAdmins(tx)) === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            "La strategia ldap-only richiede almeno un amministratore attivo e approvato con una password locale, " +
            "che è l'accesso di emergenza quando LDAP non autentica nessuno. Un accesso locale forzato conta solo " +
            'dopo che il link per impostare la password è stato usato.',
        });
      }
    }

    return writeConfigsTx(tx, writes);
  });
}
