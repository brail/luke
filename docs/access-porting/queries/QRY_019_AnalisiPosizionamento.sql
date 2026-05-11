-- ============================================================
-- QRY_019 — AnalisiPosizionamento
-- Fonte originale: AnalisiPosizionamento
-- Scopo: Paia confermate per articolo/colore/taglia con prezzi wholesale e retail
-- Parametri:
--   @Marchio   VARCHAR(20)  — marchio
--   @Stagione  VARCHAR(10)  — stagione
-- Note porting:
--   - In Access AnalisiPosizionamentoWholesalePrice e AnalisiPosizionamentoRetailPrice
--     erano query separate per i listini — inlinizzate qui come CTE
--   - Variable Code 02 = Taglia (seconda variabile dell'assortimento)
--   - IIF(IsNull(...)=False, prezzo, '') → CASE WHEN prezzo IS NOT NULL THEN CAST(prezzo AS VARCHAR) ELSE ''
-- ============================================================

WITH

-- Listino wholesale per articolo (prezzi applicabili a tutti i clienti, tipo wholesale)
WholesalePrice AS (
    SELECT
        sp.[Item No_]                                       AS ArticleNo,
        MAX(sp.[Unit Price])                                AS WSPrice
    FROM [NewEra$Sales Price] sp
    WHERE sp.[Sales Type] = 0   -- tutti i clienti
      AND sp.[Price Type] = 0   -- wholesale (verificare codice esatto in FEBOS_10)
    GROUP BY sp.[Item No_]
),

-- Listino retail per articolo
RetailPrice AS (
    SELECT
        sp.[Item No_]                                       AS ArticleNo,
        MAX(sp.[Unit Price])                                AS RetailPrice
    FROM [NewEra$Sales Price] sp
    WHERE sp.[Sales Type] = 0
      AND sp.[Price Type] = 1   -- retail
    GROUP BY sp.[Item No_]
)

SELECT
    i.[Line Code]                                           AS Linea,
    sl.[No_]                                               AS Articolo,
    sl.[Constant Variable Code]                            AS CodiceColore,
    vc.[Description]                                       AS Colore,
    sl.[Variable Code 02]                                  AS Taglia,
    i.[Trademark Code]                                     AS Marchio,
    i.[Season Code]                                        AS Stagione,
    i.[Description]                                        AS Descrizione,
    i.[Description 2]                                      AS Descrizione2,
    i.[Product Family]                                     AS FamigliaProdotto,
    i.[Product Sex]                                        AS GenereProdotto,
    i.[Collection Code],
    i.[Vendor No_],
    vend.[Name]                                            AS VendorName,

    -- Paia confermate (solo ordini senza delete_reason)
    SUM(
        CASE
            WHEN sl.[Delete Reason] = '' OR sl.[Delete Reason] IS NULL
            THEN ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0)
            ELSE 0
        END
    )                                                       AS PaiaConfermate,

    -- Prezzi (mostrati come stringa se disponibili, vuoti altrimenti)
    CASE WHEN ws.WSPrice IS NOT NULL THEN CAST(ws.WSPrice AS VARCHAR(50)) ELSE '' END AS WholesalePriceC,
    CASE WHEN rp.RetailPrice IS NOT NULL THEN CAST(rp.RetailPrice AS VARCHAR(50)) ELSE '' END AS RetailPriceC

FROM [NewEra$Sales Line] sl
    INNER JOIN [NewEra$Item] i ON sl.[No_] = i.[No_]
    LEFT JOIN [NewEra$Vendor] vend ON i.[Vendor No_] = vend.[No_]
    INNER JOIN [NewEra$Variable Code] vc
        ON sl.[Variable Code 01] = vc.[Variable Code]
        AND sl.[Variable Group 01] = vc.[Variable Group]
    LEFT JOIN WholesalePrice ws ON sl.[No_] = ws.ArticleNo
    LEFT JOIN RetailPrice rp    ON sl.[No_] = rp.ArticleNo

WHERE sl.[Type] IN (19, 20)
  AND i.[Trademark Code] = @Marchio
  AND i.[Season Code]    = @Stagione
  AND sl.[Document Type] = 1              -- solo ordini (non resi/note credito)

GROUP BY
    i.[Line Code], sl.[No_], sl.[Constant Variable Code], vc.[Description],
    sl.[Variable Code 02], i.[Trademark Code], i.[Season Code],
    i.[Description], i.[Description 2], i.[Product Family], i.[Product Sex],
    i.[Collection Code], i.[Vendor No_], vend.[Name],
    ws.WSPrice, rp.RetailPrice

ORDER BY Linea, Articolo, CodiceColore, Taglia;
