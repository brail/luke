import { chromium, FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  console.log('🚀 Starting global setup for E2E tests...');

  // Avvia il browser per verificare che tutto funzioni
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    // Verifica che l'app sia accessibile
    const baseURL = config.projects[0].use.baseURL || 'http://localhost:3000';
    console.log(`📡 Checking if app is accessible at ${baseURL}...`);

    await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 30000 });

    // Verifica che la pagina si carichi correttamente
    const title = await page.title();
    console.log(`✅ App loaded successfully. Page title: ${title}`);
  } catch (error) {
    console.error('❌ Global setup failed:', error);
    throw error;
  } finally {
    await browser.close();
  }

  console.log('✅ Global setup completed successfully');
}

export default globalSetup;
