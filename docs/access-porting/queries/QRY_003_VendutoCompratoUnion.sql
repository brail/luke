-- ============================================================
-- QRY_003 — VendutoCompratoUnion
-- Fonte originale: def01-qAcqEVend-Union
-- Scopo: Consolida acquisti e vendite in un unico dataset (BOTH + AcqOnly + VendOnly)
-- Parametri:
--   @Stagione      VARCHAR(10)  — stagione da analizzare
--   @Marchio       VARCHAR(20)  — marchio da analizzare
--   @CambioUSDEUR  DECIMAL(10,4) — tasso cambio (passato a QRY_001)
-- Note porting:
--   - La chiave di matching e' Articolo + CodiceColore + Assortimento
--   - Usare UNION ALL (non UNION) per preservare tutti i record
--   - Dipende da QRY_001 (qAcqGrouped) e QRY_002 (qVendGrouped)
-- ============================================================

WITH

-- === Acquisti aggregati (da QRY_001) ===
AcquistiBase AS (
    SELECT
        pl.[No_]                                            AS PurchasesArt,
        pl.[Constant Variable Code]                        AS PurchasesColorCode,
        pl.[Assortment Code]                               AS PurchasesAssortment,
        pl.[Currency Code]                                 AS CurrencyCodePurchase,
        SUM(ISNULL(TRY_CAST(pl.[Quantity] AS DECIMAL(18,4)), 0))        AS QuantityPurchased,
        SUM(ISNULL(TRY_CAST(pl.[No_ of Pairs] AS DECIMAL(18,4)), 0))   AS PairsPurchased,
        SUM(ISNULL(TRY_CAST(pl.[Av_ Net Unit Cost] AS DECIMAL(18,4)), 0)
            * ISNULL(TRY_CAST(pl.[No_ of Pairs] AS DECIMAL(18,4)), 0)) AS ValuePurchased,
        SUM(CASE
            WHEN pl.[Currency Code] = 'USD'
                THEN (ISNULL(TRY_CAST(pl.[Av_ Net Unit Cost] AS DECIMAL(18,4)), 0)
                      * ISNULL(TRY_CAST(pl.[No_ of Pairs] AS DECIMAL(18,4)), 0))
                     / @CambioUSDEUR
            ELSE ISNULL(TRY_CAST(pl.[Av_ Net Unit Cost] AS DECIMAL(18,4)), 0)
                 * ISNULL(TRY_CAST(pl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
        END)                                               AS ValuePurchasedEur,
        -- Ricevuto e fatturato (calcolati proporzionalmente come in QRY_001)
        SUM(ISNULL(TRY_CAST(pl.[Quantity Received] AS DECIMAL(18,4)), 0))   AS QuantityReceived,
        SUM(CASE WHEN ISNULL(TRY_CAST(pl.[Quantity] AS DECIMAL(18,4)), 0) > 0
            THEN ISNULL(TRY_CAST(pl.[Quantity Received] AS DECIMAL(18,4)), 0)
                 / ISNULL(TRY_CAST(pl.[Quantity] AS DECIMAL(18,4)), 1)
                 * ISNULL(TRY_CAST(pl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
            ELSE 0 END)                                    AS PairsReceived,
        SUM(ISNULL(TRY_CAST(pl.[Quantity Invoiced] AS DECIMAL(18,4)), 0))   AS QuantityInvoicedPurchases,
        SUM(CASE WHEN ISNULL(TRY_CAST(pl.[Quantity] AS DECIMAL(18,4)), 0) > 0
            THEN ISNULL(TRY_CAST(pl.[Quantity Invoiced] AS DECIMAL(18,4)), 0)
                 / ISNULL(TRY_CAST(pl.[Quantity] AS DECIMAL(18,4)), 1)
                 * ISNULL(TRY_CAST(pl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
            ELSE 0 END)                                    AS PairsInvoicedPurchases,
        SUM(ISNULL(TRY_CAST(pl.[Av_ Net Unit Cost] AS DECIMAL(18,4)), 0)
            * ISNULL(TRY_CAST(pl.[No_ of Pairs] AS DECIMAL(18,4)), 0)) AS ValueInvoicedPurchases
    FROM [NewEra$Purchase Line] pl
        INNER JOIN [NewEra$Item] i ON pl.[No_] = i.[No_]
    WHERE pl.[Type] IN (19, 20)
      AND i.[Season Code]    = @Stagione
      AND i.[Trademark Code] = @Marchio
    GROUP BY pl.[No_], pl.[Constant Variable Code], pl.[Assortment Code], pl.[Currency Code]
),

-- === Vendite aggregate (da QRY_002) ===
VenditeBase AS (
    SELECT
        sl.[No_]                                            AS SalesArt,
        sl.[Constant Variable Code]                        AS SalesColorCode,
        sl.[Assortment Code]                               AS SalesAssortment,
        SUM(ISNULL(TRY_CAST(sl.[Average Unit Price] AS DECIMAL(18,4)), 0)
            * ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0))  AS GrossSalesValue,
        SUM((ISNULL(TRY_CAST(sl.[Average Unit Price] AS DECIMAL(18,4)), 0)
             * ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0))
            - (ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
               - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0))) AS DiscountValue,
        SUM(ISNULL(TRY_CAST(sl.[Area Manager Commission _] AS DECIMAL(18,4)), 0)
            * (ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
               - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0))
            / 10)                                          AS AreaManagerCommissionValue,
        SUM(ISNULL(TRY_CAST(sl.[Salesperson Commission _] AS DECIMAL(18,4)), 0)
            * (ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
               - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0))
            / 100)                                         AS SalesPersonCommissionValue,
        SUM(ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0))        AS QuantitySold,
        SUM(ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0))   AS PairsSold,
        SUM(ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
            - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0)) AS ValueSold,
        SUM(CASE WHEN ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0) > 0
            THEN ISNULL(TRY_CAST(sl.[Quantity Shipped] AS DECIMAL(18,4)), 0)
                 / ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 1)
                 * ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
            ELSE 0 END)                                    AS PairsShipped,
        SUM(ISNULL(TRY_CAST(sl.[Quantity Shipped] AS DECIMAL(18,4)), 0)) AS QuantityShipped,
        SUM(CASE WHEN ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0) > 0
            THEN ISNULL(TRY_CAST(sl.[Quantity Invoiced] AS DECIMAL(18,4)), 0)
                 / ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 1)
                 * ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
            ELSE 0 END)                                    AS PairsInvoiced,
        SUM(ISNULL(TRY_CAST(sl.[Quantity Invoiced] AS DECIMAL(18,4)), 0)) AS QuantityInvoiced,
        SUM(CASE WHEN ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0) > 0
            THEN ISNULL(TRY_CAST(sl.[Quantity Invoiced] AS DECIMAL(18,4)), 0)
                 / ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 1)
                 * (ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
                    - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0))
            ELSE 0 END)                                    AS ValueInvoiced
    FROM [NewEra$Sales Line] sl
        INNER JOIN [NewEra$Sales Header] sh ON sl.[Document No_] = sh.[No_]
            AND sl.[Document Type] = sh.[Document Type]
        INNER JOIN [NewEra$Item] i ON sl.[No_] = i.[No_]
    WHERE sl.[Type] IN (19, 20)
      AND i.[Season Code]    = @Stagione
      AND i.[Trademark Code] = @Marchio
    GROUP BY sl.[No_], sl.[Constant Variable Code], sl.[Assortment Code]
)

-- === UNION ALL dei tre casi ===

-- Ramo 1: articoli con ENTRAMBI acquisti e vendite
SELECT
    a.PurchasesArt    AS Article,
    a.PurchasesColorCode AS ColorCode,
    a.PurchasesAssortment AS Assortment,
    a.QuantityPurchased, a.PairsPurchased, a.ValuePurchased, a.ValuePurchasedEur,
    a.QuantityReceived, a.PairsReceived, a.ValueInvoicedPurchases,
    a.QuantityInvoicedPurchases, a.PairsInvoicedPurchases, a.CurrencyCodePurchase,
    v.QuantitySold, v.PairsSold, v.ValueSold,
    v.QuantityShipped, v.PairsShipped, v.QuantityInvoiced, v.PairsInvoiced, v.ValueInvoiced,
    v.GrossSalesValue, v.DiscountValue, v.AreaManagerCommissionValue, v.SalesPersonCommissionValue
FROM AcquistiBase a
    INNER JOIN VenditeBase v
        ON a.PurchasesArt         = v.SalesArt
        AND a.PurchasesColorCode  = v.SalesColorCode
        AND a.PurchasesAssortment = v.SalesAssortment

UNION ALL

-- Ramo 2: solo acquisti (da piazzare)
SELECT
    a.PurchasesArt, a.PurchasesColorCode, a.PurchasesAssortment,
    a.QuantityPurchased, a.PairsPurchased, a.ValuePurchased, a.ValuePurchasedEur,
    a.QuantityReceived, a.PairsReceived, a.ValueInvoicedPurchases,
    a.QuantityInvoicedPurchases, a.PairsInvoicedPurchases, a.CurrencyCodePurchase,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0  -- colonne vendite = 0
FROM AcquistiBase a
    LEFT JOIN VenditeBase v
        ON a.PurchasesArt = v.SalesArt AND a.PurchasesColorCode = v.SalesColorCode
        AND a.PurchasesAssortment = v.SalesAssortment
WHERE v.SalesArt IS NULL

UNION ALL

-- Ramo 3: solo vendite (da comprare)
SELECT
    v.SalesArt, v.SalesColorCode, v.SalesAssortment,
    0, 0, 0, 0, 0, 0, 0, 0, 0, NULL,    -- colonne acquisti = 0/NULL
    v.QuantitySold, v.PairsSold, v.ValueSold,
    v.QuantityShipped, v.PairsShipped, v.QuantityInvoiced, v.PairsInvoiced, v.ValueInvoiced,
    v.GrossSalesValue, v.DiscountValue, v.AreaManagerCommissionValue, v.SalesPersonCommissionValue
FROM VenditeBase v
    LEFT JOIN AcquistiBase a
        ON v.SalesArt = a.PurchasesArt AND v.SalesColorCode = a.PurchasesColorCode
        AND v.SalesAssortment = a.PurchasesAssortment
WHERE a.PurchasesArt IS NULL;
