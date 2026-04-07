-- ============================================================
-- QRY_017 — AnalisiConsegneVendite
-- Fonte originale: AnalisiDateConsegnaVendite
-- Scopo: Date di consegna ordini di vendita vs data effettiva spedizione, con tipo ordine
-- Parametri:
--   @Stagione  VARCHAR(10)  — stagione da analizzare
--   @Marchio   VARCHAR(20)  — marchio (opzionale)
-- Note porting:
--   - Order Type e' un enum NAV con valori 0-5 e 17 (campo custom NewEra)
--     0=Programmato, 1=Riassortimento, 2=Pronto, 3=Stock, 4=Sostituzione, 5=PreSeason, 17=Commerciale
--   - Payment Method Code, Geographical Zone, Ship-to City vengono dall'intestazione ordine
-- ============================================================

WITH

-- Ordini di vendita con date
OrdiniVendita AS (
    SELECT
        sh.[No_]                                            AS OrderNumber,
        sh.[Order Date],
        sh.[Salesperson Code],
        sp.[Name]                                           AS SalespersonName,
        sh.[Sell-to Customer No_],
        c.[Name]                                            AS CustomerName,
        sh.[Ship-to City],
        sh.[Payment Method Code],
        sh.[Order Type],
        -- Classificazione tipo ordine (IIF annidati in Access → CASE WHEN in T-SQL)
        CASE sh.[Order Type]
            WHEN 0  THEN 'Programmato'
            WHEN 1  THEN 'Riassortimento'
            WHEN 2  THEN 'Pronto'
            WHEN 3  THEN 'Stock'
            WHEN 4  THEN 'Sostituzione'
            WHEN 5  THEN 'PreSeason'
            WHEN 17 THEN 'Commerciale'
            ELSE '?'
        END                                                 AS TipoOrdine,
        gz1.[Description]                                  AS GeoZone1,
        gz2.[Description]                                  AS GeoZone2,
        sl.[No_]                                           AS ArticleNo,
        sl.[Constant Variable Code]                        AS ColorCode,
        sl.[Assortment Code],
        sl.[Delete Reason],
        sl.[Planned Shipment Date]                         AS DataSpedizionePrevista,
        sl.[Requested Delivery Date]                       AS DataConsegnaRichiesta,
        ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0) AS PairsOrdered,
        i.[Trademark Code]                                 AS Marchio,
        i.[Season Code]                                    AS Stagione,
        i.[Line Code]                                      AS Linea,
        i.[Description],
        i.[Description 2],
        i.[Manufacturer Code]                              AS ManufacturerCode

    FROM [NewEra$Sales Line] sl
        INNER JOIN [NewEra$Sales Header] sh
            ON sl.[Document Type] = sh.[Document Type]
            AND sl.[Document No_] = sh.[No_]
        LEFT JOIN [NewEra$Salesperson_Purchaser] sp ON sh.[Salesperson Code] = sp.[Code]
        LEFT JOIN [NewEra$Customer] c ON sh.[Sell-to Customer No_] = c.[No_]
        LEFT JOIN [NewEra$Geographical Zone] gz1 ON c.[Geographical Zone] = gz1.[Geographical Zone]
        LEFT JOIN [NewEra$Geographical Zone] gz2 ON c.[Geographical Zone 2] = gz2.[Geographical Zone]
        INNER JOIN [NewEra$Item] i ON sl.[No_] = i.[No_]

    WHERE sl.[Type] IN (19, 20)
      AND sl.[Document Type] = 1              -- solo ordini (non resi)
      AND i.[Season Code] = @Stagione
      AND (i.[Trademark Code] = @Marchio OR @Marchio IS NULL)
),

-- Spedizioni effettive (DDT registrati)
Spedizioni AS (
    SELECT
        ddtl.[Order No_]                                   AS OrderNumber,
        ddtl.[No_]                                         AS ArticleNo,
        ddtl.[Constant Variable Code]                      AS ColorCode,
        MIN(ddth.[Posted Date])                            AS DataSpedizioneEffettiva,
        SUM(ISNULL(TRY_CAST(ddtl.[Quantity] AS DECIMAL(18,4)), 0)) AS PairsShipped

    FROM [NewEra$DDT_Picking Line] ddtl
        INNER JOIN [NewEra$DDT_Picking Header] ddth ON ddtl.[Document No_] = ddth.[No_]
    WHERE ddth.[Document Type] = 0              -- DDT uscita
      AND ddth.[Status] = 20                    -- DDT registrato/postato
      AND ddtl.[Type] IN (19, 20)
    GROUP BY ddtl.[Order No_], ddtl.[No_], ddtl.[Constant Variable Code]
)

SELECT
    ov.*,
    vend.[Name]                                            AS ManufacturerName,
    s.DataSpedizioneEffettiva,
    s.PairsShipped,
    -- Scostamento spedizione in giorni
    CASE
        WHEN s.DataSpedizioneEffettiva IS NOT NULL AND ov.DataSpedizionePrevista IS NOT NULL
        THEN DATEDIFF(day, ov.DataSpedizionePrevista, s.DataSpedizioneEffettiva)
        ELSE NULL
    END                                                    AS GiorniScostamento,
    -- Stato
    CASE
        WHEN s.DataSpedizioneEffettiva IS NULL THEN 'Non spedito'
        WHEN DATEDIFF(day, ov.DataSpedizionePrevista, s.DataSpedizioneEffettiva) <= 0 THEN 'In orario/anticipo'
        ELSE 'In ritardo'
    END                                                    AS StatoSpedizione

FROM OrdiniVendita ov
    LEFT JOIN [NewEra$Vendor] vend ON ov.ManufacturerCode = vend.[No_]
    LEFT JOIN Spedizioni s
        ON ov.OrderNumber = s.OrderNumber
        AND ov.ArticleNo  = s.ArticleNo
        AND ov.ColorCode  = s.ColorCode

ORDER BY ov.Stagione, ov.Marchio, ov.SalespersonCode, ov.OrderNumber;
