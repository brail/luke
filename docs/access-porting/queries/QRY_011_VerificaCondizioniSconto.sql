-- ============================================================
-- QRY_011 — VerificaCondizioniSconto
-- Fonte originale: NDCRegistrate-VerificaCondizioniSconto
-- Scopo: NDC registrate che contengono righe testo con "SCO" (condizioni sconto)
-- Parametri:
--   @DataIniziale  DATE  — inizio periodo (era [Forms]![Principale]![DataIniziale])
--   @DataFinale    DATE  — fine periodo   (era [Forms]![Principale]![DataFinale])
-- Note porting:
--   - Type=0 nelle righe NDC = righe testo/commento (non articolo, non CoGe)
--   - LIKE '*SCO*' in Access -> LIKE '%SCO%' in T-SQL
--   - Il GROUP BY + HAVING e' usato come filtro combinato su data e descrizione
-- ============================================================

SELECT
    scmh.[No_]                          AS NumeroNDC,
    scmh.[Shortcut Dimension 1 Code]    AS Marchio,
    scmh.[Shortcut Dimension 2 Code]    AS CCR,
    scmh.[Selling Season Code]          AS Stagione,
    scmh.[Bill-to Customer No_]         AS CodiceCliente,
    scmh.[Bill-to Name]                 AS NomeCliente,
    scmh.[Posting Date]                 AS DataRegistrazione,
    scml.[Description]                  AS DescrizioneRiga

FROM [NewEra$Sales Cr_Memo Line] scml
    INNER JOIN [NewEra$Sales Cr_Memo Header] scmh
        ON scml.[Document No_] = scmh.[No_]

WHERE scml.[Type] = 0                               -- solo righe testo
  AND scmh.[Posting Date] BETWEEN @DataIniziale AND @DataFinale
  AND scml.[Description] LIKE '%SCO%'               -- contiene "SCO" = condizioni sconto

GROUP BY
    scmh.[No_], scmh.[Shortcut Dimension 1 Code], scmh.[Shortcut Dimension 2 Code],
    scmh.[Selling Season Code], scmh.[Bill-to Customer No_], scmh.[Bill-to Name],
    scmh.[Posting Date], scml.[Description]

ORDER BY scmh.[Posting Date], scmh.[No_];
