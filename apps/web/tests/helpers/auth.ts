import { Page, expect } from '@playwright/test';

/**
 * Helper per autenticazione nei test E2E
 */
export class AuthHelper {
  constructor(private page: Page) {}

  /**
   * Effettua login come admin
   */
  async loginAsAdmin() {
    await this.page.goto('/login');

    // Aspetta che la pagina di login si carichi
    await expect(this.page.locator('form')).toBeVisible();

    // Compila il form di login
    await this.page.fill('input[name="email"]', 'admin@example.com');
    await this.page.fill('input[name="password"]', 'admin123');

    // Clicca sul pulsante di login
    await this.page.click('button[type="submit"]');

    // Aspetta il redirect alla dashboard
    await this.page.waitForURL('/dashboard', { timeout: 10000 });

    // Verifica che l'utente sia loggato
    await expect(this.page.locator('[data-testid="user-menu"]')).toBeVisible();
  }

  /**
   * Effettua login come editor
   */
  async loginAsEditor() {
    await this.page.goto('/login');

    await expect(this.page.locator('form')).toBeVisible();

    await this.page.fill('input[name="email"]', 'editor@example.com');
    await this.page.fill('input[name="password"]', 'editor123');

    await this.page.click('button[type="submit"]');

    await this.page.waitForURL('/dashboard', { timeout: 10000 });
    await expect(this.page.locator('[data-testid="user-menu"]')).toBeVisible();
  }

  /**
   * Effettua logout
   */
  async logout() {
    // Clicca sul menu utente
    await this.page.click('[data-testid="user-menu"]');

    // Clicca su logout
    await this.page.click('[data-testid="logout-button"]');

    // Aspetta il redirect alla pagina di login
    await this.page.waitForURL('/login', { timeout: 10000 });
  }

  /**
   * Verifica che l'utente sia autenticato
   */
  async expectAuthenticated() {
    await expect(this.page.locator('[data-testid="user-menu"]')).toBeVisible();
  }

  /**
   * Verifica che l'utente non sia autenticato
   */
  async expectNotAuthenticated() {
    await expect(
      this.page.locator('[data-testid="user-menu"]')
    ).not.toBeVisible();
  }
}

/**
 * Helper per navigazione nei test E2E
 */
export class NavigationHelper {
  constructor(private page: Page) {}

  /**
   * Naviga alla pagina brands
   */
  async goToBrands() {
    await this.page.goto('/settings/brands');
    await expect(
      this.page.locator('[data-testid="brands-page"]')
    ).toBeVisible();
  }

  /**
   * Naviga alla dashboard
   */
  async goToDashboard() {
    await this.page.goto('/dashboard');
    await expect(this.page.locator('[data-testid="dashboard"]')).toBeVisible();
  }

  /**
   * Naviga alle impostazioni
   */
  async goToSettings() {
    await this.page.goto('/settings');
    await expect(
      this.page.locator('[data-testid="settings-page"]')
    ).toBeVisible();
  }
}

/**
 * Helper per interazioni con i brand nei test E2E
 */
export class BrandHelper {
  constructor(private page: Page) {}

  /**
   * Crea un nuovo brand
   */
  async createBrand(code: string, name: string) {
    // Clicca su "Nuovo Brand"
    await this.page.click('[data-testid="new-brand-button"]');

    // Aspetta che il dialog si apra
    await expect(
      this.page.locator('[data-testid="brand-dialog"]')
    ).toBeVisible();

    // Compila il form
    await this.page.fill('input[name="code"]', code);
    await this.page.fill('input[name="name"]', name);

    // Salva
    await this.page.click('[data-testid="save-brand-button"]');

    // Aspetta che il dialog si chiuda
    await expect(
      this.page.locator('[data-testid="brand-dialog"]')
    ).not.toBeVisible();

    // Verifica che il brand sia stato creato
    await expect(
      this.page.locator(`[data-testid="brand-row-${code}"]`)
    ).toBeVisible();
  }

  /**
   * Modifica un brand esistente
   */
  async editBrand(code: string, newName: string) {
    // Clicca sul pulsante edit del brand
    await this.page.click(`[data-testid="edit-brand-button-${code}"]`);

    // Aspetta che il dialog si apra
    await expect(
      this.page.locator('[data-testid="brand-dialog"]')
    ).toBeVisible();

    // Modifica il nome
    await this.page.fill('input[name="name"]', newName);

    // Salva
    await this.page.click('[data-testid="save-brand-button"]');

    // Aspetta che il dialog si chiuda
    await expect(
      this.page.locator('[data-testid="brand-dialog"]')
    ).not.toBeVisible();
  }

  /**
   * Elimina un brand (soft delete)
   */
  async deleteBrand(code: string) {
    // Clicca sul pulsante delete del brand
    await this.page.click(`[data-testid="delete-brand-button-${code}"]`);

    // Conferma la cancellazione nel dialog
    await expect(
      this.page.locator('[data-testid="confirm-delete-dialog"]')
    ).toBeVisible();
    await this.page.click('[data-testid="confirm-delete-button"]');

    // Verifica che il brand non sia più visibile
    await expect(
      this.page.locator(`[data-testid="brand-row-${code}"]`)
    ).not.toBeVisible();
  }

  /**
   * Upload logo per un brand
   */
  async uploadLogo(code: string, logoPath: string) {
    // Clicca sul pulsante edit del brand
    await this.page.click(`[data-testid="edit-brand-button-${code}"]`);

    // Aspetta che il dialog si apra
    await expect(
      this.page.locator('[data-testid="brand-dialog"]')
    ).toBeVisible();

    // Upload del file
    const fileInput = this.page.locator('input[type="file"]');
    await fileInput.setInputFiles(logoPath);

    // Aspetta che l'upload sia completato
    await expect(
      this.page.locator('[data-testid="logo-preview"]')
    ).toBeVisible();

    // Salva
    await this.page.click('[data-testid="save-brand-button"]');

    // Aspetta che il dialog si chiuda
    await expect(
      this.page.locator('[data-testid="brand-dialog"]')
    ).not.toBeVisible();
  }

  /**
   * Verifica che un brand esista nella lista
   */
  async expectBrandExists(code: string) {
    await expect(
      this.page.locator(`[data-testid="brand-row-${code}"]`)
    ).toBeVisible();
  }

  /**
   * Verifica che un brand non esista nella lista
   */
  async expectBrandNotExists(code: string) {
    await expect(
      this.page.locator(`[data-testid="brand-row-${code}"]`)
    ).not.toBeVisible();
  }
}

/**
 * Helper per gestire i toast/notifiche
 */
export class ToastHelper {
  constructor(private page: Page) {}

  /**
   * Aspetta che appaia un toast di successo
   */
  async expectSuccessToast(message?: string) {
    const toast = this.page.locator('[data-testid="success-toast"]');
    await expect(toast).toBeVisible();

    if (message) {
      await expect(toast).toContainText(message);
    }
  }

  /**
   * Aspetta che appaia un toast di errore
   */
  async expectErrorToast(message?: string) {
    const toast = this.page.locator('[data-testid="error-toast"]');
    await expect(toast).toBeVisible();

    if (message) {
      await expect(toast).toContainText(message);
    }
  }

  /**
   * Chiude tutti i toast visibili
   */
  async closeAllToasts() {
    const closeButtons = this.page.locator('[data-testid="toast-close"]');
    const count = await closeButtons.count();

    for (let i = 0; i < count; i++) {
      await closeButtons.nth(i).click();
    }
  }
}
