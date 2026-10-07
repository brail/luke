/**
 * The report `check-config-rows.ts` prints, computed from the AppConfig rows alone so it can be
 * tested without a database.
 */

import { isAppConfigKey, isConfigRouterKey, validateConfigValue } from '@luke/core';

/** One AppConfig row, as the script reads it. */
export interface ConfigRow {
  key: string;
  value: string;
  isEncrypted: boolean;
}

/** What needs an operator's attention, by key only. */
export interface ConfigRowsReport {
  total: number;
  /** Registered keys outside the router prefixes: their own settings page manages them. */
  ownedElsewhere: number;
  /** Unregistered rows outside the router prefixes: nothing in the application can delete them. */
  strandedOrphans: string[];
  /** Unregistered rows under the router prefixes: still deletable from the settings page. */
  deletableOrphans: string[];
  /**
   * Registered, unencrypted rows whose value their schema refuses — the check `saveConfig` applies.
   * The message never quotes the value: Zod 4's defaults and the registry's own texts do not.
   */
  invalid: Array<{ key: string; message: string }>;
  /**
   * Registered, unencrypted rows stored as `''`: how 2.1.6 recorded "not configured" (Google
   * impersonation, an OAuth disconnect). Their readers still treat it so; deleting them only tidies.
   */
  emptyStored: string[];
  /** Registered encrypted rows: checking them needs the master key, which this script never reads. */
  encryptedSkipped: number;
  hasBaseUrl: boolean;
  attention: boolean;
}

export function checkConfigRows(rows: ConfigRow[]): ConfigRowsReport {
  const keys = rows.map(row => row.key);
  const unregistered = keys.filter(key => !isAppConfigKey(key));
  const strandedOrphans = unregistered.filter(key => !isConfigRouterKey(key));
  const deletableOrphans = unregistered.filter(key => isConfigRouterKey(key));
  const hasBaseUrl = keys.includes('app.baseUrl');
  const checked = rows.filter(row => !row.isEncrypted && isAppConfigKey(row.key));
  const emptyStored = checked.filter(row => row.value === '').map(row => row.key);
  const invalid = checked.flatMap(row => {
    if (row.value === '' || !isAppConfigKey(row.key)) return [];
    const verdict = validateConfigValue(row.key, row.value);
    return verdict.success ? [] : [{ key: row.key, message: verdict.message }];
  });

  return {
    total: keys.length,
    ownedElsewhere: keys.filter(key => isAppConfigKey(key) && !isConfigRouterKey(key)).length,
    strandedOrphans,
    deletableOrphans,
    invalid,
    emptyStored,
    encryptedSkipped: rows.filter(row => row.isEncrypted && isAppConfigKey(row.key)).length,
    hasBaseUrl,
    attention: strandedOrphans.length > 0 || invalid.length > 0 || !hasBaseUrl,
  };
}
