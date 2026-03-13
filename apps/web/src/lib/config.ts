/**
 * Configurazione centralizzata dell'applicazione
 * Accessibile sia dal frontend che dal backend
 */
import { isDevelopment, isProduction } from '@luke/core';

// Configurazioni statiche (non dipendenti dal database)
export const appConfig = {
  environment: isDevelopment() ? 'development' : isProduction() ? 'production' : 'test',
  isDevelopment: isDevelopment(),
  isProduction: isProduction(),
  isTest: !isDevelopment() && !isProduction(),
} as const;

// Note: name e version sono ora recuperati dinamicamente dal database
// tramite useAppConfig() hook per seguire il pattern architetturale corretto

export default appConfig;
