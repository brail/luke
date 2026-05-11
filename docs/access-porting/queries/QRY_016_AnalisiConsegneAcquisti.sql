-- ============================================================
-- QRY_016 — AnalisiConsegneAcquisti
-- Fonte originale: AnalisiDateConsegna (via AnalisiDateConsegna-Union)
-- Scopo: Scostamento tra data prevista e data effettiva di consegna acquisti per articolo
-- Parametri:
--   @Stagione  VARCHAR(10)  — stagione da analizzare
--   @Marchio   VARCHAR(20)  — marchio (opzionale)
-- Note porting:
--   - AnalisiDateConsegna-Union e' una UNION fra piu' step che aggrega per ordine/articolo
--   - Il dato viene arricchito con info fornitore (acquirente + produttore) dall'intestazione ordine
--   - In NAV la "data prevista consegna" e' [Planned Receipt Date] o [Expected Receipt Date]
--   - La data effettiva e' [Posting Date] della ricevuta acquisto (Purch_ Rcpt_ Header)
-- ============================================================

WITH

-- Linee ordini acquisto con date previste
OrdiniAcquisto AS (
    SELECT
        ph.[No_]                                            AS OrderNumber,
        ph.[Order Date],
        ph.[Buy-from Vendor No_]                           AS VendorCode,
        pl.[No_]                                           AS ArticleNo,
        pl.[Constant Variable Code]                        AS ColorCode,
        pl.[Assortment Code],
        pl.[Planned Receipt Date]                          AS DataConsegnaPrevista,
        pl.[Requested Receipt Date]                        AS DataConsegnaRichiesta,
        ISNULL(TRY_CAST(pl.[Quantity] AS DECIMAL(18,4)), 0) AS QuantityOrdered,
        ISNULL(TRY_CAST(pl.[No_ of Pairs] AS DECIMAL(18,4)), 0) AS PairsOrdered,
        pl.[Manufacturer Code]                             AS ManufacturerCode,
        i.[Trademark Code]                                 AS Marchio,
        i.[Season Code]                                    AS Stagione,
        i.[Line Code]                                      AS Linea,
        i.[Description],
        i.[Description 2],
        i.[Product Family],
        i.[Product Sex]

    FROM [NewEra$Purchase Line] pl
        INNER JOIN [NewEra$Purchase Header] ph ON pl.[Document No_] = ph.[No_]
        INNER JOIN [NewEra$Item] i ON pl.[No_] = i.[No_]

    WHERE pl.[Type] IN (19, 20)
      AND i.[Season Code] = @Stagione
      AND (i.[Trademark Code] = @Marchio OR @Marchio IS NULL)
),

-- Ricevute acquisto con data effettiva
Ricevute AS (
    SELECT
        rl.[Order No_]                                     AS OrderNumber,
        rl.[No_]                                           AS ArticleNo,
        rl.[Constant Variable Code]                        AS ColorCode,
        rl.[Assortment Code],
        MIN(rh.[Posting Date])                             AS DataConsegnaEffettiva,
        SUM(ISNULL(TRY_CAST(rl.[No_ of Pairs] AS DECIMAL(18,4)), 0)) AS PairsReceived

    FROM [NewEra$Purch_ Rcpt_ Line] rl
        INNER JOIN [NewEra$Purch_ Rcpt_ Header] rh ON rl.[Document No_] = rh.[No_]
    WHERE rl.[Type] IN (19, 20)
    GROUP BY rl.[Order No_], rl.[No_], rl.[Constant Variable Code], rl.[Assortment Code]
)

SELECT
    oa.*,
    vend.[Name]                                            AS VendorName,
    vend1.[Name]                                           AS ManufacturerName,
    r.DataConsegnaEffettiva,
    r.PairsReceived,
    -- Scostamento in giorni (positivo = ritardo; negativo = anticipo)
    CASE
        WHEN r.DataConsegnaEffettiva IS NOT NULL AND oa.DataConsegnaPrevista IS NOT NULL
        THEN DATEDIFF(day, oa.DataConsegnaPrevista, r.DataConsegnaEffettiva)
        ELSE NULL
    END                                                    AS GiorniScostamento,
    -- Stato consegna
    CASE
        WHEN r.DataConsegnaEffettiva IS NULL THEN 'Non ancora ricevuto'
        WHEN DATEDIFF(day, oa.DataConsegnaPrevista, r.DataConsegnaEffettiva) <= 0 THEN 'In orario/anticipo'
        WHEN DATEDIFF(day, oa.DataConsegnaPrevista, r.DataConsegnaEffettiva) <= 14 THEN 'Ritardo lieve (<=14gg)'
        ELSE 'Ritardo significativo (>14gg)'
    END                                                    AS StatoConsegna

FROM OrdiniAcquisto oa
    INNER JOIN [NewEra$Purchase Header] ph ON oa.OrderNumber = ph.[No_]
    INNER JOIN [NewEra$Vendor] vend ON ph.[Buy-from Vendor No_] = vend.[No_]
    LEFT JOIN [NewEra$Vendor] vend1 ON oa.ManufacturerCode = vend1.[No_]
    LEFT JOIN Ricevute r
        ON oa.OrderNumber = r.OrderNumber
        AND oa.ArticleNo  = r.ArticleNo
        AND oa.ColorCode  = r.ColorCode
        AND oa.AssortmentCode = r.AssortmentCode

ORDER BY oa.Stagione, oa.Marchio, oa.VendorCode, oa.OrderNumber, oa.ArticleNo;
