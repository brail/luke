-- ============================================================
-- QRY_001 — AcquistiBase
-- Fonte originale: qAcq
-- Scopo: Righe ordini di acquisto con quantita/valore/ricevuto/fatturato, conversione USD→EUR
-- Parametri:
--   @CambioUSDEUR  DECIMAL(10,4)  — tasso cambio EUR/USD (era [forms]![principale]![cambioeurodollaro])
-- Note porting:
--   - Val() in Access gestisce NULL e stringa vuota restituendo 0; usare ISNULL(TRY_CAST(...), 0)
--   - PairsReceived e' calcolato proporzionalmente su qty; se qty=0 il risultato e' 0
--   - Questa query e' la base di tutta la catena def01-qAcqEVend-*
--   - NON filtra per stagione/marchio: il filtro viene iniettato dinamicamente dal VBA
-- ============================================================

WITH AcquistiBase AS (
    SELECT
        pl.[Document Type],
        pl.[Type],
        pl.[Document No_],
        pl.[No_]                                AS ArticleNo,
        pl.[Unit of Measure],
        pl.[Constant Variable Code]             AS ColorCode,
        pl.[Assortment Code],
        pl.[Delete Reason],
        pl.[Av_ Net Unit Cost]                  AS AvgNetUnitCost,
        pl.[Currency Code]                      AS CurrencyCodePurchase,

        -- Quantità e paia ordinate
        ISNULL(TRY_CAST(pl.[Quantity] AS DECIMAL(18,4)), 0)        AS QuantityPurchased,
        ISNULL(TRY_CAST(pl.[No_ of Pairs] AS DECIMAL(18,4)), 0)    AS PairsPurchased,

        -- Valore in valuta originale
        ISNULL(TRY_CAST(pl.[Av_ Net Unit Cost] AS DECIMAL(18,4)), 0)
            * ISNULL(TRY_CAST(pl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
                                                AS ValuePurchased,

        -- Valore in EUR (conversione USD se necessario)
        CASE
            WHEN pl.[Currency Code] = 'USD'
                THEN (ISNULL(TRY_CAST(pl.[Av_ Net Unit Cost] AS DECIMAL(18,4)), 0)
                      * ISNULL(TRY_CAST(pl.[No_ of Pairs] AS DECIMAL(18,4)), 0))
                     / @CambioUSDEUR
            WHEN pl.[Currency Code] = '' OR pl.[Currency Code] IS NULL
                THEN ISNULL(TRY_CAST(pl.[Av_ Net Unit Cost] AS DECIMAL(18,4)), 0)
                     * ISNULL(TRY_CAST(pl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
            ELSE NULL  -- 'ERROR CURRENCY NOT AVAILABLE' in Access
        END                                     AS ValuePurchasedEur,

        -- Quantità ricevute (proporzionale a qty ordinate)
        ISNULL(TRY_CAST(pl.[Quantity Received] AS DECIMAL(18,4)), 0)
                                                AS QuantityReceived,
        CASE
            WHEN ISNULL(TRY_CAST(pl.[Quantity] AS DECIMAL(18,4)), 0) > 0
                THEN ISNULL(TRY_CAST(pl.[Quantity Received] AS DECIMAL(18,4)), 0)
                     / ISNULL(TRY_CAST(pl.[Quantity] AS DECIMAL(18,4)), 1)
                     * ISNULL(TRY_CAST(pl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
            ELSE 0
        END                                     AS PairsReceived,
        CASE
            WHEN ISNULL(TRY_CAST(pl.[Quantity] AS DECIMAL(18,4)), 0) > 0
                THEN ISNULL(TRY_CAST(pl.[Quantity Received] AS DECIMAL(18,4)), 0)
                     / ISNULL(TRY_CAST(pl.[Quantity] AS DECIMAL(18,4)), 1)
                     * ISNULL(TRY_CAST(pl.[Line Amount] AS DECIMAL(18,4)), 0)
            ELSE 0
        END                                     AS ValueReceived,

        -- Quantità fatturate (proporzionale)
        ISNULL(TRY_CAST(pl.[Quantity Invoiced] AS DECIMAL(18,4)), 0)
                                                AS QuantityInvoicedPurchases,
        CASE
            WHEN ISNULL(TRY_CAST(pl.[Quantity] AS DECIMAL(18,4)), 0) > 0
                THEN ISNULL(TRY_CAST(pl.[Quantity Invoiced] AS DECIMAL(18,4)), 0)
                     / ISNULL(TRY_CAST(pl.[Quantity] AS DECIMAL(18,4)), 1)
                     * ISNULL(TRY_CAST(pl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
            ELSE 0
        END                                     AS PairsInvoicedPurchases,
        CASE
            WHEN ISNULL(TRY_CAST(pl.[Quantity] AS DECIMAL(18,4)), 0) > 0
                THEN ISNULL(TRY_CAST(pl.[Quantity Invoiced] AS DECIMAL(18,4)), 0)
                     / ISNULL(TRY_CAST(pl.[Quantity] AS DECIMAL(18,4)), 1)
                     * ISNULL(TRY_CAST(pl.[Line Amount] AS DECIMAL(18,4)), 0)
            ELSE 0
        END                                     AS ValueInvoicedPurchases,

        -- Costo unitario (alias per uso downstream)
        ISNULL(TRY_CAST(pl.[Av_ Net Unit Cost] AS DECIMAL(18,4)), 0) AS Costo

    FROM [NewEra$Purchase Line] pl
    WHERE
        pl.[Type] IN (19, 20)  -- 19 = articolo modello, 20 = assortimento
)

SELECT * FROM AcquistiBase;
-- Nota: il filtro stagione/marchio viene aggiunto dinamicamente nella chiamata API
-- Esempio: AND ArticleNo IN (SELECT No_ FROM [NewEra$Item] WHERE [Season Code] = @Stagione AND [Trademark Code] = @Marchio)
