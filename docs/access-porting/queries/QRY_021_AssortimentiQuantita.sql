-- ============================================================
-- QRY_021 — AssortimentiQuantita
-- Fonte originale: AssortimentiQuantita
-- Scopo: Quantita' totale per assortimento e gruppo variabili
-- Parametri:
--   @AssortmentCode  VARCHAR(50)  — codice assortimento (opzionale; NULL = tutti)
-- Note porting:
--   - [Assortment Quantity] e' una tabella NAV specifica NewEra (modulo assortimenti custom)
--   - Variable Group identifica il tipo di variabile (colore, taglia, etc.)
--   - Usata come input per le analisi di disponibilita' e allocazione
-- ============================================================

SELECT
    aq.[Assortment Code],
    aq.[Variable Group],
    SUM(ISNULL(TRY_CAST(aq.[Quantity] AS DECIMAL(18,4)), 0)) AS AssortmentQuantity

FROM [NewEra$Assortment Quantity] aq

WHERE (aq.[Assortment Code] = @AssortmentCode OR @AssortmentCode IS NULL)

GROUP BY aq.[Assortment Code], aq.[Variable Group]

ORDER BY aq.[Assortment Code], aq.[Variable Group];
