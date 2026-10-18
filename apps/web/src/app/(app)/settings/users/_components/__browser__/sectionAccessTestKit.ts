import {
  Roles,
  SECTION_ACCESS_DEFAULTS,
  sectionEnum,
  type Role,
  type Section,
} from '@luke/core';

/** What `sectionAccess.getDefaults` answers with no role map stored and `disabledSections` killed. */
export function defaultsWith(disabledSections: string[] = []) {
  const sectionAccessDefaults = Object.fromEntries(
    Roles.map(role => [
      role,
      Object.fromEntries(
        sectionEnum.options.map(s => [s, SECTION_ACCESS_DEFAULTS[role][s] ? 'enabled' : 'disabled'])
      ),
    ])
    // `Object.fromEntries` loses the key types; both maps are built from the exhaustive lists.
  ) as Record<Role, Record<Section, 'enabled' | 'disabled'>>;
  return { sectionAccessDefaults, disabledSections };
}

/** Overrides in the shape `sectionAccess.getByUser` returns. */
export const rows = (overrides: Record<string, boolean>) =>
  Object.entries(overrides).map(([section, enabled]) => ({ section, enabled }));

/** A promise and the functions that settle it, for a call left in flight. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The `set` calls made, as `section → enabled`, in order. */
export const setCalls = (mock: { mock: { calls: unknown[][] } }) =>
  mock.mock.calls.map(([input]) => {
    const { section, enabled } = input as { section: string; enabled: boolean | null };
    return [section, enabled] as const;
  });
