/**
 * Supported IANA timezone identifiers for user profile selection,
 * covering the most common zones across Europe, America, Asia, Oceania, and UTC.
 */

export interface TimezoneOption {
  value: string;
  label: string;
}

/** Full list of supported timezones with display labels, grouped by continent. */
export const TIMEZONES: TimezoneOption[] = [
  // Europa
  { value: 'Europe/Rome', label: 'Europa/Roma (CET/CEST)' },
  { value: 'Europe/London', label: 'Europa/Londra (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Europa/Parigi (CET/CEST)' },
  { value: 'Europe/Berlin', label: 'Europa/Berlino (CET/CEST)' },
  { value: 'Europe/Madrid', label: 'Europa/Madrid (CET/CEST)' },
  { value: 'Europe/Amsterdam', label: 'Europa/Amsterdam (CET/CEST)' },
  { value: 'Europe/Stockholm', label: 'Europa/Stoccolma (CET/CEST)' },
  { value: 'Europe/Zurich', label: 'Europa/Zurigo (CET/CEST)' },
  { value: 'Europe/Vienna', label: 'Europa/Vienna (CET/CEST)' },
  { value: 'Europe/Prague', label: 'Europa/Praga (CET/CEST)' },

  // America
  { value: 'America/New_York', label: 'America/New York (EST/EDT)' },
  { value: 'America/Chicago', label: 'America/Chicago (CST/CDT)' },
  { value: 'America/Denver', label: 'America/Denver (MST/MDT)' },
  { value: 'America/Los_Angeles', label: 'America/Los Angeles (PST/PDT)' },
  { value: 'America/Toronto', label: 'America/Toronto (EST/EDT)' },
  { value: 'America/Sao_Paulo', label: 'America/São Paulo (BRT)' },
  { value: 'America/Mexico_City', label: 'America/Mexico City (CST/CDT)' },

  // Asia
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (CST)' },
  { value: 'Asia/Seoul', label: 'Asia/Seoul (KST)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST)' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' },

  // Oceania
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST/AEDT)' },
  { value: 'Australia/Melbourne', label: 'Australia/Melbourne (AEST/AEDT)' },
  { value: 'Pacific/Auckland', label: 'Pacific/Auckland (NZST/NZDT)' },

  // UTC
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
];

/** Finds a `TimezoneOption` by its IANA identifier, or `undefined` if not found. */
export function findTimezoneByValue(value: string): TimezoneOption | undefined {
  return TIMEZONES.find(timezone => timezone.value === value);
}

/** Returns the application default timezone (`Europe/Rome`). */
export function getDefaultTimezone(): string {
  return 'Europe/Rome';
}

/**
 * Returns the browser's current IANA timezone from `Intl.DateTimeFormat`.
 * Falls back to `getDefaultTimezone()` if the API is unavailable.
 */
export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return getDefaultTimezone();
  }
}
