/**
 * Supported UI locales (BCP 47 tags) for user profile selection.
 */

export interface LocaleOption {
  value: string;
  label: string;
}

/** Full list of supported locales with human-readable labels. */
export const LOCALES: LocaleOption[] = [
  { value: 'it-IT', label: 'Italiano' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es-ES', label: 'Español' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'pt-PT', label: 'Português' },
  { value: 'nl-NL', label: 'Nederlands' },
  { value: 'sv-SE', label: 'Svenska' },
  { value: 'no-NO', label: 'Norsk' },
  { value: 'da-DK', label: 'Dansk' },
  { value: 'fi-FI', label: 'Suomi' },
  { value: 'pl-PL', label: 'Polski' },
  { value: 'cs-CZ', label: 'Čeština' },
  { value: 'hu-HU', label: 'Magyar' },
  { value: 'ru-RU', label: 'Русский' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'zh-CN', label: '中文 (简体)' },
  { value: 'zh-TW', label: '中文 (繁體)' },
];

/** Finds a `LocaleOption` by its BCP 47 value, or `undefined` if not found. */
export function findLocaleByValue(value: string): LocaleOption | undefined {
  return LOCALES.find(locale => locale.value === value);
}

/** Returns the application default locale (`it-IT`). */
export function getDefaultLocale(): string {
  return 'it-IT';
}
