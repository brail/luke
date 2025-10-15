/**
 * Configurazione centralizzata dell'applicazione
 * Accessibile sia dal frontend che dal backend
 */

// Configurazioni statiche (non dipendenti dal database)
export const appConfig = {
  environment: process.env.NODE_ENV,
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
} as const;

// Note: name e version sono ora recuperati dinamicamente dal database
// tramite useAppConfig() hook per seguire il pattern architetturale corretto

// Note: Le funzioni getAppInfo() e getLoginDemoText() sono state rimosse
// per seguire il pattern architetturale corretto. Usa useAppConfig() hook
// per recuperare dinamicamente le configurazioni dal database tramite API.

export default appConfig;
