-- ============================================================
-- QRY_004 — VendutoCompratoAnalisi (ZFinal + MoreData)
-- Fonte originale: def01-qAcqEVend-ZFinal-PerAnalisi + def01-qAcqEVend-ZFinal-PerAnalisi-MoreData
-- Scopo: Arricchisce il dataset Union con anagrafica articolo, delta, proiezioni e KPI forecast
-- Parametri:
--   @Stagione          VARCHAR(10)    — stagione (passato a QRY_003)
--   @Marchio           VARCHAR(20)    — marchio (passato a QRY_003)
--   @CambioUSDEUR      DECIMAL(10,4)  — cambio (passato a QRY_003)
--   @FattoreCorrettivo DECIMAL(5,4)   — moltiplicatore previsione (es: 1.10 = +10%)
--                                       era [forms]![principale]![fattorecorrettivo]
-- Note porting:
--   - IIf in Access -> CASE WHEN in T-SQL
--   - DatiCarryOverESMU e' una tabella locale Access: da valutare se portare in Luke
--   - Il campo "costo" e' il costo unitario medio acquisto (Av_ Net Unit Cost)
--   - SalesForecastAssortmentPairs usa QuantitySold (assortimenti) non PairsSold (paia)
-- ============================================================

-- Dipende da QRY_003 (VendutoCompratoUnion) e da QRY_001/002 come CTE interne

WITH VendutoCompratoUnion AS (
    -- Riferimento a QRY_003 — inserire qui l'intera CTE o usarla come vista
    -- [PLACEHOLDER: inline QRY_003 qui oppure creare vista vw_VendutoCompratoUnion]
    SELECT 1 AS placeholder  -- sostituire con la CTE completa
),

VendutoCompratoAnalisi AS (
    SELECT
        u.*,

        -- Anagrafica articolo
        i.[Description 2]           AS Descrizione2,
        i.[Vendor No_]              AS VendorCode,
        v.[Name]                    AS Vendor,
        vc.[Description]            AS Color,
        i.[Trademark Code]          AS Marchio,
        i.[Collection Code]         AS CollectionCode,
        i.[Season Code]             AS Stagione,
        i.[Line Code]               AS Linea,
        i.[Season Typology],
        i.[Product Family]          AS FamigliaProdotto,
        i.[Product Sex]             AS GenereProdotto,
        i.[Shipment Priority],

        -- Costo unitario (dall'acquisto, per calcoli downstream)
        ISNULL(TRY_CAST(pl_avg.[Av_ Net Unit Cost] AS DECIMAL(18,4)), 0) AS Costo,

        -- Delta: paia da piazzare (acquisti > vendite)
        CASE
            WHEN u.PairsSold - u.PairsPurchased < 0
            THEN u.PairsSold - u.PairsPurchased
            ELSE 0
        END AS deltaPiazzarePairs,

        -- Valore da piazzare (basato su costo unitario)
        CASE
            WHEN u.PairsSold - u.PairsPurchased < 0
            THEN ISNULL(TRY_CAST(pl_avg.[Av_ Net Unit Cost] AS DECIMAL(18,4)), 0)
                 * (CASE WHEN u.PairsSold - u.PairsPurchased < 0
                         THEN u.PairsSold - u.PairsPurchased ELSE 0 END)
            ELSE 0
        END AS deltaPiazzareValue,

        -- Delta: paia da comprare (vendite > acquisti)
        CASE
            WHEN u.PairsSold - u.PairsPurchased > 0
            THEN u.PairsSold - u.PairsPurchased
            ELSE 0
        END AS deltaComprarePairs,

        -- Valore da comprare (basato su costo unitario)
        CASE
            WHEN u.PairsSold - u.PairsPurchased > 0
            THEN ISNULL(TRY_CAST(pl_avg.[Av_ Net Unit Cost] AS DECIMAL(18,4)), 0)
                 * (CASE WHEN u.PairsSold - u.PairsPurchased > 0
                         THEN u.PairsSold - u.PairsPurchased ELSE 0 END)
            ELSE 0
        END AS deltaComprareValue,

        -- Delta assortimenti
        CASE WHEN u.QuantitySold - u.QuantityPurchased > 0
             THEN u.QuantitySold - u.QuantityPurchased ELSE 0 END AS deltaComprareAssortments,
        CASE WHEN u.QuantitySold - u.QuantityPurchased < 0
             THEN u.QuantitySold - u.QuantityPurchased ELSE 0 END AS deltaPiazzareAssortments,

        -- Proiezione flat (fattore correttivo su paia)
        @FattoreCorrettivo * u.PairsSold AS SalesForecastPairs,

        -- Proiezione su assortimenti (arrotondata)
        ROUND(@FattoreCorrettivo * u.QuantitySold, 0) AS SalesForecastAssortment,

        -- Proiezione su paia via assortimento (proporzionale)
        CASE
            WHEN u.QuantitySold <> 0
            THEN ROUND(@FattoreCorrettivo * u.QuantitySold, 0)
                 * u.PairsSold / u.QuantitySold
            ELSE 0
        END AS SalesForecastAssortmentPairs,

        -- Valore forecast assortimento paia
        CASE
            WHEN u.QuantitySold <> 0
            THEN ROUND(@FattoreCorrettivo * u.QuantitySold, 0)
                 * u.PairsSold / u.QuantitySold
                 * ISNULL(TRY_CAST(pl_avg.[Av_ Net Unit Cost] AS DECIMAL(18,4)), 0)
            ELSE 0
        END AS SalesForecastAssortmentPairsValue

    FROM VendutoCompratoUnion u
        INNER JOIN [NewEra$Item] i ON u.Article = i.[No_]
        LEFT JOIN [NewEra$Vendor] v ON i.[Vendor No_] = v.[No_]
        LEFT JOIN [NewEra$Variable Code] vc
            ON u.ColorCode = vc.[Variable Code]
            -- Nota: in NAV il Variable Group e' necessario per disambiguare; verificare il gruppo colore
        -- Costo medio dalla tabella acquisti (aggregato per articolo/colore)
        LEFT JOIN (
            SELECT pl2.[No_], pl2.[Constant Variable Code],
                   AVG(ISNULL(TRY_CAST(pl2.[Av_ Net Unit Cost] AS DECIMAL(18,4)), 0)) AS [Av_ Net Unit Cost]
            FROM [NewEra$Purchase Line] pl2
            WHERE pl2.[Type] IN (19, 20)
            GROUP BY pl2.[No_], pl2.[Constant Variable Code]
        ) pl_avg ON u.Article = pl_avg.[No_] AND u.ColorCode = pl_avg.[Constant Variable Code]
        -- DatiCarryOverESMU: tabella locale Access — da portare in Luke o eliminare
        -- LEFT JOIN DatiCarryOverESMU co ON u.Article = co.[Model Item No_] AND u.ColorCode = co.[Variable Code 01]
),

-- === MoreData: delta forecast vs acquisti (secondo layer) ===
VendutoCompratoMoreData AS (
    SELECT
        z.*,

        -- Paia da comprare per raggiungere il forecast
        CASE
            WHEN z.SalesForecastAssortmentPairs - z.PairsPurchased > 0
            THEN z.SalesForecastAssortmentPairs - z.PairsPurchased
            ELSE 0
        END AS deltaComprareForcastAssortmentPairs,

        -- Paia da piazzare rispetto al forecast
        CASE
            WHEN z.SalesForecastAssortmentPairs - z.PairsPurchased < 0
            THEN z.SalesForecastAssortmentPairs - z.PairsPurchased
            ELSE 0
        END AS deltaPiazzareforecastAssortmentPairs,

        -- Paia sellable = forecast - paia da comprare
        z.SalesForecastAssortmentPairs
            - CASE WHEN z.SalesForecastAssortmentPairs - z.PairsPurchased > 0
                   THEN z.SalesForecastAssortmentPairs - z.PairsPurchased ELSE 0 END
            AS SellableForecastAssortmentPairs,

        -- Valore sellable (proporzionale al forecast value)
        CASE
            WHEN z.SalesForecastAssortmentPairs <> 0
            THEN z.SalesForecastAssortmentPairsValue
                 * (z.SalesForecastAssortmentPairs
                    - CASE WHEN z.SalesForecastAssortmentPairs - z.PairsPurchased > 0
                           THEN z.SalesForecastAssortmentPairs - z.PairsPurchased ELSE 0 END)
                 / z.SalesForecastAssortmentPairs
            ELSE 0
        END AS SellableForecastAssortmentPairsValue

    FROM VendutoCompratoAnalisi z
)

SELECT * FROM VendutoCompratoMoreData
ORDER BY Marchio, Stagione, Linea, Article, ColorCode;
