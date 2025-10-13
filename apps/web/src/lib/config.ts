/**
 * Configurazione centralizzata dell'applicazione
 * Accessibile sia dal frontend che dal backend
 */

export const appConfig = {
  version: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0',
  name: process.env.NEXT_PUBLIC_APP_NAME || 'Luke',
  environment: process.env.NODE_ENV,
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
} as const;

/**
 * Ottiene le informazioni dell'app per la visualizzazione
 */
export const getAppInfo = () => ({
  version: appConfig.version,
  name: appConfig.name,
  environment: appConfig.environment,
  isDevelopment: appConfig.isDevelopment,
  isProduction: appConfig.isProduction,
  displayName: `${appConfig.name} v${appConfig.version}`,
  environmentLabel: appConfig.isDevelopment
    ? '(Development)'
    : appConfig.isProduction
      ? '(Production)'
      : '',
});

/**
 * Ottiene il testo completo per la pagina di login
 */
export const getLoginDemoText = () => {
  const appInfo = getAppInfo();
  return `${appInfo.displayName} ${appInfo.environmentLabel}`;
};

export default appConfig;
