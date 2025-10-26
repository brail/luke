import { FullConfig } from '@playwright/test';

async function globalTeardown(_config: FullConfig) {
  console.log('🧹 Starting global teardown for E2E tests...');

  // Qui potresti aggiungere cleanup globale se necessario
  // Ad esempio: pulizia database di test, cleanup file temporanei, etc.

  console.log('✅ Global teardown completed successfully');
}

export default globalTeardown;
