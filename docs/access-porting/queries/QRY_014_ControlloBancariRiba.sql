-- ============================================================
-- QRY_014 — ControlloBancariRiba
-- Fonte originale: ControlloCCBancariRiba
-- Scopo: Ordini RIBA senza coordinate bancarie valide (ABI/CAB mancanti o IBAN vuoto)
-- Parametri:
--   @Stagione  VARCHAR(10)  — stagione (opzionale; NULL = tutte)
--   @Marchio   VARCHAR(20)  — marchio  (opzionale; NULL = tutti)
-- Note porting:
--   - Il join su Customer Bank Account usa sia Customer No_ che il codice Bank Account sull'ordine
--   - La condizione di errore e' OR fra tre casi: code IS NULL, ABI vuoto, IBAN vuoto
-- ============================================================

SELECT
    sh.[No_]                                AS NumeroOrdine,
    sh.[Bill-to Customer No_]              AS CodiceCliente,
    sh.[Bill-to Name]                      AS NomeCliente,
    sh.[Payment Method Code]               AS MetodoPagamento,
    sh.[Shortcut Dimension 2 Code]         AS Marchio,
    sh.[Selling Season Code]               AS Stagione,
    cba.[Code]                             AS CodiceCC,
    cba.[Name]                             AS NomeCC,
    cba.[IBAN],
    cba.[ABI],
    cba.[CAB],
    -- Motivo dell'anomalia
    CASE
        WHEN cba.[Code] IS NULL         THEN 'CC non trovato'
        WHEN cba.[ABI]  = ''            THEN 'ABI mancante'
        WHEN cba.[IBAN] = ''            THEN 'IBAN mancante'
        ELSE 'Altro'
    END                                    AS MotivoAnomalia

FROM [NewEra$Sales Header] sh
    LEFT JOIN [NewEra$Customer Bank Account] cba
        ON sh.[Bill-to Customer No_] = cba.[Customer No_]
        AND sh.[Bank Account] = cba.[Code]

WHERE sh.[Payment Method Code] = 'RIBA'
  AND sh.[Document Type] = 1              -- ordini aperti
  AND (sh.[Selling Season Code] = @Stagione OR @Stagione IS NULL)
  AND (sh.[Shortcut Dimension 2 Code] = @Marchio OR @Marchio IS NULL)
  AND (
      cba.[Code] IS NULL
      OR cba.[ABI]  = ''
      OR cba.[IBAN] = ''
  )

ORDER BY sh.[Selling Season Code], sh.[Bill-to Customer No_], sh.[No_];
