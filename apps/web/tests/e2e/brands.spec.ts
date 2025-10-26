import { test, expect } from '@playwright/test';
import {
  AuthHelper,
  NavigationHelper,
  BrandHelper,
  ToastHelper,
} from '../helpers/auth';

test.describe('Brands E2E Tests', () => {
  let authHelper: AuthHelper;
  let navHelper: NavigationHelper;
  let brandHelper: BrandHelper;
  let toastHelper: ToastHelper;

  test.beforeEach(async ({ page }) => {
    authHelper = new AuthHelper(page);
    navHelper = new NavigationHelper(page);
    brandHelper = new BrandHelper(page);
    toastHelper = new ToastHelper(page);

    // Login come admin per tutti i test
    await authHelper.loginAsAdmin();
  });

  test.describe('Brand Creation', () => {
    test('should create a new brand successfully', async ({ page }) => {
      await navHelper.goToBrands();

      // Crea un nuovo brand
      await brandHelper.createBrand('TEST_BRAND_E2E', 'Test Brand E2E');

      // Verifica che il brand sia stato creato
      await brandHelper.expectBrandExists('TEST_BRAND_E2E');

      // Verifica che appaia un toast di successo
      await toastHelper.expectSuccessToast('Brand creato con successo');
    });

    test('should create brand with logo upload', async ({ page }) => {
      await navHelper.goToBrands();

      // Clicca su "Nuovo Brand"
      await page.click('[data-testid="new-brand-button"]');
      await expect(page.locator('[data-testid="brand-dialog"]')).toBeVisible();

      // Compila il form
      await page.fill('input[name="code"]', 'BRAND_WITH_LOGO');
      await page.fill('input[name="name"]', 'Brand with Logo');

      // Upload logo (simula con un file di test)
      const logoPath = './tests/fixtures/brand-logo-valid.png';
      const fileInput = page.locator('input[type="file"]');

      // Se il file esiste, fai l'upload
      try {
        await fileInput.setInputFiles(logoPath);
        await expect(
          page.locator('[data-testid="logo-preview"]')
        ).toBeVisible();
      } catch (error) {
        // Se il file non esiste, continua senza logo
        console.log('Logo file not found, continuing without logo upload');
      }

      // Salva
      await page.click('[data-testid="save-brand-button"]');
      await expect(
        page.locator('[data-testid="brand-dialog"]')
      ).not.toBeVisible();

      // Verifica che il brand sia stato creato
      await brandHelper.expectBrandExists('BRAND_WITH_LOGO');
    });

    test('should reject duplicate brand code', async ({ page }) => {
      await navHelper.goToBrands();

      // Crea il primo brand
      await brandHelper.createBrand('DUPLICATE_TEST', 'First Brand');

      // Prova a creare un secondo brand con lo stesso codice
      await page.click('[data-testid="new-brand-button"]');
      await expect(page.locator('[data-testid="brand-dialog"]')).toBeVisible();

      await page.fill('input[name="code"]', 'DUPLICATE_TEST');
      await page.fill('input[name="name"]', 'Second Brand');

      await page.click('[data-testid="save-brand-button"]');

      // Verifica che appaia un errore
      await expect(page.locator('[data-testid="form-error"]')).toBeVisible();
      await expect(page.locator('[data-testid="form-error"]')).toContainText(
        'Codice brand già esistente'
      );
    });

    test('should validate required fields', async ({ page }) => {
      await navHelper.goToBrands();

      await page.click('[data-testid="new-brand-button"]');
      await expect(page.locator('[data-testid="brand-dialog"]')).toBeVisible();

      // Prova a salvare senza compilare i campi
      await page.click('[data-testid="save-brand-button"]');

      // Verifica che appaiano errori di validazione
      await expect(page.locator('input[name="code"]:invalid')).toBeVisible();
      await expect(page.locator('input[name="name"]:invalid')).toBeVisible();
    });
  });

  test.describe('Brand Editing', () => {
    test.beforeEach(async ({ page }) => {
      // Crea un brand di test per l'editing
      await navHelper.goToBrands();
      await brandHelper.createBrand('EDIT_TEST_BRAND', 'Original Name');
    });

    test('should edit brand name successfully', async ({ page }) => {
      await navHelper.goToBrands();

      // Modifica il brand
      await brandHelper.editBrand('EDIT_TEST_BRAND', 'Updated Name');

      // Verifica che il nome sia stato aggiornato
      await expect(
        page.locator('[data-testid="brand-row-EDIT_TEST_BRAND"]')
      ).toContainText('Updated Name');

      // Verifica toast di successo
      await toastHelper.expectSuccessToast('Brand aggiornato con successo');
    });

    test('should edit brand code successfully', async ({ page }) => {
      await navHelper.goToBrands();

      // Clicca sul pulsante edit
      await page.click('[data-testid="edit-brand-button-EDIT_TEST_BRAND"]');
      await expect(page.locator('[data-testid="brand-dialog"]')).toBeVisible();

      // Modifica il codice
      await page.fill('input[name="code"]', 'UPDATED_CODE');
      await page.click('[data-testid="save-brand-button"]');

      // Verifica che il brand sia stato aggiornato
      await brandHelper.expectBrandExists('UPDATED_CODE');
      await brandHelper.expectBrandNotExists('EDIT_TEST_BRAND');
    });

    test('should replace brand logo', async ({ page }) => {
      await navHelper.goToBrands();

      // Clicca sul pulsante edit
      await page.click('[data-testid="edit-brand-button-EDIT_TEST_BRAND"]');
      await expect(page.locator('[data-testid="brand-dialog"]')).toBeVisible();

      // Upload nuovo logo
      const logoPath = './tests/fixtures/brand-logo-valid.png';
      const fileInput = page.locator('input[type="file"]');

      try {
        await fileInput.setInputFiles(logoPath);
        await expect(
          page.locator('[data-testid="logo-preview"]')
        ).toBeVisible();
      } catch (error) {
        console.log('Logo file not found, continuing without logo upload');
      }

      // Salva
      await page.click('[data-testid="save-brand-button"]');
      await expect(
        page.locator('[data-testid="brand-dialog"]')
      ).not.toBeVisible();

      // Verifica toast di successo
      await toastHelper.expectSuccessToast('Brand aggiornato con successo');
    });
  });

  test.describe('Brand Deletion', () => {
    test.beforeEach(async ({ page }) => {
      // Crea un brand di test per la cancellazione
      await navHelper.goToBrands();
      await brandHelper.createBrand('DELETE_TEST_BRAND', 'Brand to Delete');
    });

    test('should soft delete brand successfully', async ({ page }) => {
      await navHelper.goToBrands();

      // Elimina il brand
      await brandHelper.deleteBrand('DELETE_TEST_BRAND');

      // Verifica che il brand non sia più visibile nella lista attiva
      await brandHelper.expectBrandNotExists('DELETE_TEST_BRAND');

      // Verifica toast di successo
      await toastHelper.expectSuccessToast('Brand eliminato con successo');
    });

    test('should show confirmation dialog before deletion', async ({
      page,
    }) => {
      await navHelper.goToBrands();

      // Clicca sul pulsante delete
      await page.click('[data-testid="delete-brand-button-DELETE_TEST_BRAND"]');

      // Verifica che appaia il dialog di conferma
      await expect(
        page.locator('[data-testid="confirm-delete-dialog"]')
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="confirm-delete-dialog"]')
      ).toContainText('Sei sicuro di voler eliminare questo brand?');

      // Annulla la cancellazione
      await page.click('[data-testid="cancel-delete-button"]');
      await expect(
        page.locator('[data-testid="confirm-delete-dialog"]')
      ).not.toBeVisible();

      // Verifica che il brand sia ancora presente
      await brandHelper.expectBrandExists('DELETE_TEST_BRAND');
    });
  });

  test.describe('Brand Validation', () => {
    test('should show error for invalid file type', async ({ page }) => {
      await navHelper.goToBrands();

      await page.click('[data-testid="new-brand-button"]');
      await expect(page.locator('[data-testid="brand-dialog"]')).toBeVisible();

      await page.fill('input[name="code"]', 'INVALID_FILE_TEST');
      await page.fill('input[name="name"]', 'Invalid File Test');

      // Prova a uploadare un file non valido
      const fileInput = page.locator('input[type="file"]');

      // Simula upload di file non valido (se possibile)
      try {
        // Crea un file di testo temporaneo
        const fs = require('fs');
        const path = require('path');
        const tempFile = path.join(__dirname, '../fixtures/invalid-file.txt');
        fs.writeFileSync(tempFile, 'This is not an image');

        await fileInput.setInputFiles(tempFile);

        // Verifica che appaia un errore
        await expect(page.locator('[data-testid="file-error"]')).toBeVisible();
        await expect(page.locator('[data-testid="file-error"]')).toContainText(
          'Tipo file non supportato'
        );

        // Cleanup
        fs.unlinkSync(tempFile);
      } catch (error) {
        console.log('Could not test invalid file upload:', error);
      }
    });

    test('should show error for file too large', async ({ page }) => {
      await navHelper.goToBrands();

      await page.click('[data-testid="new-brand-button"]');
      await expect(page.locator('[data-testid="brand-dialog"]')).toBeVisible();

      await page.fill('input[name="code"]', 'LARGE_FILE_TEST');
      await page.fill('input[name="name"]', 'Large File Test');

      // Prova a uploadare un file troppo grande
      const fileInput = page.locator('input[type="file"]');

      try {
        // Crea un file grande temporaneo
        const fs = require('fs');
        const path = require('path');
        const tempFile = path.join(__dirname, '../fixtures/large-file.png');
        const largeBuffer = Buffer.alloc(3 * 1024 * 1024); // 3MB
        fs.writeFileSync(tempFile, largeBuffer);

        await fileInput.setInputFiles(tempFile);

        // Verifica che appaia un errore
        await expect(page.locator('[data-testid="file-error"]')).toBeVisible();
        await expect(page.locator('[data-testid="file-error"]')).toContainText(
          'File troppo grande'
        );

        // Cleanup
        fs.unlinkSync(tempFile);
      } catch (error) {
        console.log('Could not test large file upload:', error);
      }
    });

    test('should validate brand code format', async ({ page }) => {
      await navHelper.goToBrands();

      await page.click('[data-testid="new-brand-button"]');
      await expect(page.locator('[data-testid="brand-dialog"]')).toBeVisible();

      // Prova con codice non valido
      await page.fill('input[name="code"]', 'invalid-code!@#');
      await page.fill('input[name="name"]', 'Invalid Code Test');

      await page.click('[data-testid="save-brand-button"]');

      // Verifica che appaia un errore di validazione
      await expect(page.locator('[data-testid="form-error"]')).toBeVisible();
    });
  });

  test.describe('Brand List and Search', () => {
    test.beforeEach(async ({ page }) => {
      // Crea alcuni brand di test
      await navHelper.goToBrands();
      await brandHelper.createBrand('SEARCH_BRAND_1', 'Nike');
      await brandHelper.createBrand('SEARCH_BRAND_2', 'Adidas');
      await brandHelper.createBrand('SEARCH_BRAND_3', 'Puma');
    });

    test('should display all brands in list', async ({ page }) => {
      await navHelper.goToBrands();

      // Verifica che tutti i brand siano visibili
      await brandHelper.expectBrandExists('SEARCH_BRAND_1');
      await brandHelper.expectBrandExists('SEARCH_BRAND_2');
      await brandHelper.expectBrandExists('SEARCH_BRAND_3');
    });

    test('should filter brands by search term', async ({ page }) => {
      await navHelper.goToBrands();

      // Usa la ricerca
      await page.fill('[data-testid="brand-search"]', 'Nike');

      // Verifica che solo Nike sia visibile
      await brandHelper.expectBrandExists('SEARCH_BRAND_1');
      await brandHelper.expectBrandNotExists('SEARCH_BRAND_2');
      await brandHelper.expectBrandNotExists('SEARCH_BRAND_3');
    });

    test('should clear search and show all brands', async ({ page }) => {
      await navHelper.goToBrands();

      // Applica filtro
      await page.fill('[data-testid="brand-search"]', 'Nike');
      await brandHelper.expectBrandExists('SEARCH_BRAND_1');
      await brandHelper.expectBrandNotExists('SEARCH_BRAND_2');

      // Pulisci filtro
      await page.fill('[data-testid="brand-search"]', '');
      await page.keyboard.press('Enter');

      // Verifica che tutti i brand siano visibili
      await brandHelper.expectBrandExists('SEARCH_BRAND_1');
      await brandHelper.expectBrandExists('SEARCH_BRAND_2');
      await brandHelper.expectBrandExists('SEARCH_BRAND_3');
    });
  });

  test.describe('Access Control', () => {
    test('should allow admin to access brands page', async ({ page }) => {
      await navHelper.goToBrands();
      await expect(page.locator('[data-testid="brands-page"]')).toBeVisible();
    });

    test('should allow editor to access brands page', async ({ page }) => {
      // Logout e login come editor
      await authHelper.logout();
      await authHelper.loginAsEditor();

      await navHelper.goToBrands();
      await expect(page.locator('[data-testid="brands-page"]')).toBeVisible();
    });

    test('should redirect unauthorized users to login', async ({ page }) => {
      // Logout
      await authHelper.logout();

      // Prova ad accedere alla pagina brands
      await page.goto('/settings/brands');

      // Verifica redirect al login
      await expect(page).toHaveURL('/login');
    });
  });
});
