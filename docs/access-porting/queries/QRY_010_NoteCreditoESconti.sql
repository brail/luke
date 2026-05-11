-- ============================================================
-- QRY_010 — NoteCreditoESconti
-- Fonte originale: fab02-NoteCreditoESconti-step01 + fab02-NoteCreditoESconti-step02
-- Scopo: Note di credito aggregate per cliente/marchio con sconti, classificazione Italia/Estero
-- Parametri:
--   @DataIniziale  DATE  — inizio periodo
--   @DataFinale    DATE  — fine periodo
-- Note porting:
--   - Struttura identica a QRY_009 ma su tabelle Sales Cr_Memo Header/Line
--   - Table ID = 115 in Posted Document Dimension (Sales Cr_Memo Line)
--   - Type = 2 nelle righe NDC = righe articolo
-- ============================================================

WITH NoteCreditoConMarchio AS (
    SELECT
        c.[No_]                                             AS CodiceCliente,
        c.[Name]                                            AS Rs1,
        c.[Name 2]                                          AS Rs2,
        pdd.[Dimension Value Code]                          AS Marchio,
        scml.*,
        scmh.[Document Date],
        scmh.[No_]                                          AS NumeroNDC,
        scmh.[Currency Code],
        scmh.[Gen_ Bus_ Posting Group]

    FROM [NewEra$Sales Cr_Memo Line] scml
        INNER JOIN [NewEra$Sales Cr_Memo Header] scmh ON scml.[Document No_] = scmh.[No_]
        INNER JOIN [NewEra$Customer] c ON scmh.[Sell-to Customer No_] = c.[No_]

        -- Dimensione MARCHIO (Table ID=115 = Sales Cr_Memo Line)
        INNER JOIN [NewEra$Posted Document Dimension] pdd
            ON pdd.[Document No_] = scml.[Document No_]
            AND pdd.[Line No_] = scml.[Line No_]
            AND pdd.[Table ID] = 115
            AND pdd.[Dimension Code] = 'marchio'

    WHERE scml.[Type] = 2
)

SELECT
    CodiceCliente,
    Rs1,
    Rs2,
    Marchio,
    SUM(ISNULL(TRY_CAST([Quantity] AS DECIMAL(18,4)), 0))             AS Paia,
    SUM(ISNULL(TRY_CAST([Amount] AS DECIMAL(18,4)), 0))               AS ImportoNetto,
    SUM(ISNULL(TRY_CAST([Line Discount Amount] AS DECIMAL(18,4)), 0)) AS ScontoRiga,
    SUM(ISNULL(TRY_CAST([Inv_ Discount Amount] AS DECIMAL(18,4)), 0)) AS ScontoFattura,
    SUM(ISNULL(TRY_CAST([Line Discount Amount] AS DECIMAL(18,4)), 0))
        + SUM(ISNULL(TRY_CAST([Inv_ Discount Amount] AS DECIMAL(18,4)), 0)) AS ScontoTotale,
    SUM(ISNULL(TRY_CAST([Amount] AS DECIMAL(18,4)), 0))
        + SUM(ISNULL(TRY_CAST([Line Discount Amount] AS DECIMAL(18,4)), 0))
        + SUM(ISNULL(TRY_CAST([Inv_ Discount Amount] AS DECIMAL(18,4)), 0)) AS ImportoLordo,
    CASE WHEN MAX([Gen_ Bus_ Posting Group]) = 'NAZIONALE' THEN 'ITALIA' ELSE 'ESTERO' END AS Paese,
    Document Date  AS DataDocumento,
    Currency Code  AS Valuta

FROM NoteCreditoConMarchio
WHERE Document Date BETWEEN @DataIniziale AND @DataFinale

GROUP BY
    CodiceCliente, Rs1, Rs2, Marchio,
    Document Date, Currency Code,
    CASE WHEN [Gen_ Bus_ Posting Group] = 'NAZIONALE' THEN 'ITALIA' ELSE 'ESTERO' END

ORDER BY Document Date, CodiceCliente, Marchio;
