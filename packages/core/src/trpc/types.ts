/**
 * Tipi tRPC per @luke/core
 * Definisce il tipo AppRouter per evitare dipendenze circolari
 */

// Definizione del tipo AppRouter basata sulla struttura del router API
// Questo evita dipendenze circolari e problemi di risoluzione moduli
export interface AppRouter {
  auth: {
    login: any;
    logout: any;
    register: any;
    refresh: any;
    me: any;
  };
  users: {
    list: any;
    create: any;
    update: any;
    delete: any;
    hardDelete: any;
  };
  config: {
    list: any;
    get: any;
    set: any;
    update: any;
    delete: any;
    importJson: any;
    exportJson: any;
    exists: any;
  };
  integrations: {
    test: any;
    storage: {
      saveConfig: any;
      testConnection: any;
    };
    mail: {
      saveConfig: any;
      test: any;
    };
    importExport: {
      startImport: any;
      startExport: any;
    };
    auth: {
      saveLdapConfig: any;
      getLdapConfig: any;
      testLdapConnection: any;
      testLdapSearch: any;
    };
  };
}
