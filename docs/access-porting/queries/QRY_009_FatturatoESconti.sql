-- ============================================================
-- QRY_009 — FatturatoESconti
-- Fonte originale: fab01-FatturatoESconti-step01 + fab01-FatturatoESconti-step02
-- Scopo: Fatturato per cliente/marchio con sconti riga e fattura, classificazione Italia/Estero
-- Parametri:
--   @DataIniziale  DATE  — inizio periodo (era [Forms]![Principale]![DataIniziale])
--   @DataFinale    DATE  — fine periodo   (era [Forms]![Principale]![DataFinale])
-- Note porting:
--   - In Access la dimensione MARCHIO veniva letta da [Posted Document Dimension] con Table ID=113
--     In NAV BC moderno usare [Dimension Set Entry] con Dimension Code='marchio'
--     VERIFICARE quale tabella e' disponibile in FEBOS_10
--   - Type=2 nelle righe fattura = righi articolo (esclude commenti, GL account, fixed asset)
--   - ImportoLordo = ImportoNetto + ScontoRiga + ScontoFattura
--   - Gen_Bus_Posting_Group: 'NAZIONALE' = Italia, qualsiasi altro = Estero
-- ============================================================

WITH FattureConMarchio AS (
    SELECT
        c.[No_]                                             AS CodiceCliente,
        c.[Name]                                            AS Rs1,
        c.[Name 2]                                          AS Rs2,
        -- Dimensione MARCHIO dalla riga fattura
        -- Opzione A (NAV 2013 / Posted Document Dimension):
        pdd.[Dimension Value Code]                          AS Marchio,
        -- Opzione B (NAV BC / Dimension Set Entry): usare Dimension Set Entry
        -- dse.[Dimension Value Code]                       AS Marchio,

        sil.*,
        sih.[Document Date],
        sih.[No_]                                           AS NumeroFattura,
        sih.[Currency Code],
        sih.[Gen_ Bus_ Posting Group]

    FROM [NewEra$Sales Invoice Line] sil
        INNER JOIN [NewEra$Sales Invoice Header] sih ON sil.[Document No_] = sih.[No_]
        INNER JOIN [NewEra$Customer] c ON sih.[Sell-to Customer No_] = c.[No_]

        -- Opzione A: Posted Document Dimension (NAV 2013)
        INNER JOIN [NewEra$Posted Document Dimension] pdd
            ON pdd.[Document No_] = sil.[Document No_]
            AND pdd.[Line No_] = sil.[Line No_]
            AND pdd.[Table ID] = 113                        -- 113 = Sales Invoice Line
            AND pdd.[Dimension Code] = 'marchio'

        -- Opzione B: Dimension Set Entry (NAV BC) — decommenta se disponibile
        -- INNER JOIN [NewEra$Dimension Set Entry] dse
        --     ON sih.[Dimension Set ID] = dse.[Dimension Set ID]
        --     AND dse.[Dimension Code] = 'marchio'

    WHERE sil.[Type] = 2                                    -- solo righe articolo
)

SELECT
    CodiceCliente,
    Rs1,
    Rs2,
    Marchio,
    SUM(ISNULL(TRY_CAST([Quantity] AS DECIMAL(18,4)), 0))             AS Paia,
    -- Importo netto (Amount in NAV = netto IVA)
    SUM(ISNULL(TRY_CAST([Amount] AS DECIMAL(18,4)), 0))               AS ImportoNetto,
    -- Sconti
    SUM(ISNULL(TRY_CAST([Line Discount Amount] AS DECIMAL(18,4)), 0)) AS ScontoRiga,
    SUM(ISNULL(TRY_CAST([Inv_ Discount Amount] AS DECIMAL(18,4)), 0)) AS ScontoFattura,
    SUM(ISNULL(TRY_CAST([Line Discount Amount] AS DECIMAL(18,4)), 0))
        + SUM(ISNULL(TRY_CAST([Inv_ Discount Amount] AS DECIMAL(18,4)), 0)) AS ScontoTotale,
    -- Importo lordo = netto + sconti (il "lordo" prima degli sconti)
    SUM(ISNULL(TRY_CAST([Amount] AS DECIMAL(18,4)), 0))
        + SUM(ISNULL(TRY_CAST([Line Discount Amount] AS DECIMAL(18,4)), 0))
        + SUM(ISNULL(TRY_CAST([Inv_ Discount Amount] AS DECIMAL(18,4)), 0)) AS ImportoLordo,
    -- Classificazione geografica
    CASE WHEN MAX([Gen_ Bus_ Posting Group]) = 'NAZIONALE' THEN 'ITALIA' ELSE 'ESTERO' END AS Paese,
    Document Date AS DataDocumento,
    Currency Code AS Valuta

FROM FattureConMarchio
WHERE Document Date BETWEEN @DataIniziale AND @DataFinale

GROUP BY
    CodiceCliente, Rs1, Rs2, Marchio,
    Document Date, Currency Code,
    CASE WHEN [Gen_ Bus_ Posting Group] = 'NAZIONALE' THEN 'ITALIA' ELSE 'ESTERO' END

ORDER BY Document Date, CodiceCliente, Marchio;
