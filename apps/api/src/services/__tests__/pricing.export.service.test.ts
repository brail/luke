/**
 * The pricing-grid PDF names the zone its extraction date is written in (ADR-035 §Formatting).
 */

import { describe, expect, it, vi } from 'vitest';

import type { PricingParameterSet, PrismaClient } from '@luke/db';

import * as pdf from '../../lib/export/pdf';
import { buildPricingGridPdf } from '../pricing.export.service';

vi.mock('../asset.service', () => ({
  // The brand below has no logo, which the real `resolveLogoDataUri` answers with `null` too.
  resolveLogoDataUri: vi.fn().mockResolvedValue(null),
}));

// Type assertion: no company profile, and the one table the export context reads is all there is.
const mockPrisma = { companyProfile: { findUnique: vi.fn().mockResolvedValue(null) } } as unknown as PrismaClient;

const set: PricingParameterSet = {
  id: 'p1', brandId: 'b1', seasonId: 's1', name: 'Pelle', countryCode: 'CN', purchaseCurrency: 'USD', sellingCurrency: 'EUR',
  qualityControlPercent: 0, transportInsuranceCost: 0, duty: 0, exchangeRate: 1, italyAccessoryCosts: 0, tools: 0,
  retailMultiplier: 2, optimalMargin: 52, isDefault: true, orderIndex: 0, createdAt: new Date(0), updatedAt: new Date(0),
};

describe('buildPricingGridPdf', () => {
  it("writes the header's extraction day in the requester's zone, and names it", async () => {
    const header = vi.spyOn(pdf, 'buildBrandPageHeader');

    // 23:30Z on June 30 is July 1 in Rome.
    await buildPricingGridPdf([set], { name: 'Brand', code: 'BR' }, { code: 'FW26', year: 2026 }, mockPrisma, 'Mario Rossi', new Date('2026-06-30T23:30:00Z'), 'Europe/Rome');

    expect(header.mock.calls.map(call => call[3]?.extractedInfo)).toContain('Estratto da Mario Rossi il 01/07/2026 (Europe/Rome)');
    header.mockRestore();
  });
});
