import { describe, it, expect } from 'vitest';

import { buildCalendarSummary } from '../calendars.js';

describe('buildCalendarSummary', () => {
  it('compone nome calendario nel formato Luke • brand • stagione • sezione', () => {
    // Il nome è l'unico modo per riconoscere un calendario Luke fra le decine
    // presenti in un account Workspace: il prefisso e l'ordine dei segmenti
    // sono parte del contratto, non estetica.
    expect(buildCalendarSummary('ACME', 'FW25', 'Prodotto')).toBe(
      'Luke • ACME • FW25 • Prodotto'
    );
  });

  it('non altera i segmenti ricevuti', () => {
    expect(buildCalendarSummary('a-b', '2025/26', 'Sez. 1')).toBe(
      'Luke • a-b • 2025/26 • Sez. 1'
    );
  });
});
