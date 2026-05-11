-- ============================================================
-- QRY_023 — StatusDDT
-- Fonte originale: WMS_AnalisiStatusDDT (via WMS_AnalisiStatusDDT_Detail)
-- Scopo: Riepilogo conteggio DDT e quantita' per status DDT e status warehouse
-- Parametri:
--   @Stagione  VARCHAR(10)  — stagione (opzionale)
--   @Marchio   VARCHAR(20)  — marchio  (opzionale)
-- Note porting:
--   - Status DDT: 0=Aperto, 1=Rilasciato, 20=Registrato/Postato
--   - StatusWHSE: status nel sistema warehouse (WMS)
--   - In Access il filtro era solo su Status IN (0,1) nel HAVING finale
-- ============================================================

WITH DDTDetail AS (
    SELECT
        ddth.[No_],
        ddth.[Document Type],
        ddth.[Status],
        ddth.[Selling Season Code]                         AS Stagione,
        ddth.[Shortcut Dimension 2 Code]                   AS Marchio,
        -- StatusWHSE: campo custom WMS NewEra (verificare nome esatto)
        -- ddth.[WMS Status]                               AS StatusWHSE,
        0                                                  AS StatusWHSE,  -- placeholder
        SUM(ISNULL(TRY_CAST(ddtl.[Quantity] AS DECIMAL(18,4)), 0)) AS Qty

    FROM [NewEra$DDT_Picking Header] ddth
        INNER JOIN [NewEra$DDT_Picking Line] ddtl ON ddth.[No_] = ddtl.[Document No_]
    WHERE ddth.[Document Type] = 0              -- DDT uscita
      AND ddtl.[Type] IN (19, 20)
      AND (ddth.[Selling Season Code] = @Stagione OR @Stagione IS NULL)
      AND (ddth.[Shortcut Dimension 2 Code] = @Marchio OR @Marchio IS NULL)
    GROUP BY ddth.[No_], ddth.[Document Type], ddth.[Status],
             ddth.[Selling Season Code], ddth.[Shortcut Dimension 2 Code]
)

-- Riepilogo per status
SELECT
    COUNT([No_])        AS ConteggioSPD,
    [Status],
    [StatusWHSE],
    SUM([Qty])          AS TotaleQty

FROM DDTDetail
WHERE [Status] IN (0, 1)                        -- solo aperti e rilasciati (non ancora postati)

GROUP BY [Status], [StatusWHSE]

ORDER BY [Status], [StatusWHSE];
