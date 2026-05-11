-- ============================================================
-- QRY_002 — VenditeBase
-- Fonte originale: qVend
-- Scopo: Righe ordini di vendita con paia, valore netto/lordo, commissioni agente e area manager
-- Parametri:
--   nessuno diretto — il filtro stagione/marchio viene iniettato dal chiamante
-- Note porting:
--   - Nz() in Access = ISNULL() in T-SQL
--   - Area Manager Commission_ e' divisa per 10 (in NAV e' in decimi di %)
--   - Salesperson Commission_ e' in percentuale (diviso per 100)
--   - Le righe con delete_reason valorizzato SONO incluse (filtro avviene a monte)
--   - Non filtra per stagione/marchio: il filtro viene iniettato dinamicamente
-- ============================================================

WITH VenditeBase AS (
    SELECT
        sl.[Document Type],
        sl.[Type],
        sh.[No_]                                                    AS OrderNo,
        sl.[Line No_],
        sl.[No_]                                                    AS ArticleNo,
        sl.[Unit of Measure],
        sl.[Constant Variable Code]                                 AS ColorCode,
        sl.[Assortment Code],
        sl.[Delete Reason],
        sl.[Customer Price Group],
        sl.[Average Unit Price]                                     AS GrossUnitPrice,
        sl.[Av_ Net Unit Price],
        sl.[Currency Code],
        sh.[Salesperson Code],
        sp.[Name]                                                   AS Salesperson,

        -- Quantita e paia vendute
        ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0)        AS QuantitySold,
        ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0)    AS PairsSold,

        -- Valore netto (al netto degli sconti)
        ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
            - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0)
                                                                    AS ValueSold,

        -- Valore lordo (prezzo medio x paia)
        ISNULL(TRY_CAST(sl.[Average Unit Price] AS DECIMAL(18,4)), 0)
            * ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
                                                                    AS GrossSalesValue,

        -- Sconto totale = lordo - netto
        (ISNULL(TRY_CAST(sl.[Average Unit Price] AS DECIMAL(18,4)), 0)
            * ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0))
        - (ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
            - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0))
                                                                    AS DiscountValue,

        -- Commissione area manager (valore/10 perche' in NAV e' in decimi)
        ISNULL(TRY_CAST(sl.[Area Manager Commission _] AS DECIMAL(18,4)), 0)
            * (ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
               - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0))
            / 10                                                    AS AreaManagerCommissionValue,

        -- Commissione agente (in percentuale)
        ISNULL(TRY_CAST(sl.[Salesperson Commission _] AS DECIMAL(18,4)), 0)
            * (ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
               - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0))
            / 100                                                   AS SalesPersonCommissionValue,

        -- Valore spedito (proporzionale a qty spedita / qty ordinata)
        CASE
            WHEN ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0) > 0
                THEN ISNULL(TRY_CAST(sl.[Quantity Shipped] AS DECIMAL(18,4)), 0)
                     / ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 1)
                     * (ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
                        - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0))
            ELSE 0
        END                                                         AS ValueShipped,
        CASE
            WHEN ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0) > 0
                THEN ISNULL(TRY_CAST(sl.[Quantity Shipped] AS DECIMAL(18,4)), 0)
                     / ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 1)
                     * ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
            ELSE 0
        END                                                         AS PairsShipped,
        ISNULL(TRY_CAST(sl.[Quantity Shipped] AS DECIMAL(18,4)), 0) AS QuantityShipped,

        -- Valore fatturato (proporzionale)
        ISNULL(TRY_CAST(sl.[Quantity Invoiced] AS DECIMAL(18,4)), 0) AS QuantityInvoiced,
        CASE
            WHEN ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0) > 0
                THEN ISNULL(TRY_CAST(sl.[Quantity Invoiced] AS DECIMAL(18,4)), 0)
                     / ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 1)
                     * ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
            ELSE 0
        END                                                         AS PairsInvoiced,
        CASE
            WHEN ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0) > 0
                THEN ISNULL(TRY_CAST(sl.[Quantity Invoiced] AS DECIMAL(18,4)), 0)
                     / ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 1)
                     * (ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
                        - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0))
            ELSE 0
        END                                                         AS ValueInvoiced

    FROM [NewEra$Sales Line] sl
        INNER JOIN [NewEra$Sales Header] sh
            ON sl.[Document No_] = sh.[No_]
            AND sl.[Document Type] = sh.[Document Type]
        LEFT JOIN [NewEra$Salesperson_Purchaser] sp
            ON sh.[Salesperson Code] = sp.[Code]

    WHERE sl.[Type] IN (19, 20)  -- 19 = articolo modello, 20 = assortimento
)

SELECT * FROM VenditeBase;
-- Nota: aggiungere filtro stagione/marchio via JOIN su Item:
-- INNER JOIN [NewEra$Item] i ON sl.[No_] = i.[No_]
-- WHERE i.[Season Code] = @Stagione AND i.[Trademark Code] = @Marchio
