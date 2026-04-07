-- ============================================================
-- QRY_018 — EstrazioneOrdiniCostoEXWFOB
-- Fonte originale: EstrazioneOrdiniVenditaCostoEXWFOB
-- Scopo: Ordini di vendita con costo EXW/FOB per analisi marginalita'
-- Parametri:
--   @NumeroOrdine  VARCHAR(20)  — filtro su numero ordine di vendita
--                                  era [Forms]![Principale]![FiltroODVCalcoloEXW]
--                                  Passare NULL per estrarre tutti (attenzione: query molto pesante)
-- Note porting:
--   - Il costo EXW/FOB viene da una tabella di step (ItemMasterData_EXWFOB_step0) che
--     aggrega il costo di acquisto per articolo/colore — qui inlinizzata come CTE
--   - ValueSold gestisce sia ordini (type=1, segno +) che note credito (segno -)
--   - Costo unitario = Av_ Net Unit Cost dalla tabella Purchase Line (medio)
-- ============================================================

WITH

-- Costo medio EXW/FOB per articolo/colore (da ordini di acquisto)
CostoEXWFOB AS (
    SELECT
        pl.[No_]                                            AS ArticleNo,
        pl.[Constant Variable Code]                        AS ColorCode,
        AVG(ISNULL(TRY_CAST(pl.[Av_ Net Unit Cost] AS DECIMAL(18,6)), 0)) AS Costo
    FROM [NewEra$Purchase Line] pl
    WHERE pl.[Type] IN (19, 20)
    GROUP BY pl.[No_], pl.[Constant Variable Code]
)

SELECT
    sh.[Bill-to Customer No_]                              AS CodiceCliente,
    sh.[Bill-to Name]                                      AS NomeCliente,
    sh.[No_]                                               AS NumeroOrdine,
    sl.[Delete Reason],
    sl.[Model Item No_]                                    AS ArticoloModello,
    sl.[Variable Code 01]                                  AS CodiceColore,
    sh.[Shortcut Dimension 1 Code]                         AS Linea,
    sh.[Shortcut Dimension 2 Code]                         AS Marchio,
    sh.[Selling Season Code]                               AS Stagione,
    sl.[Currency Code],
    sl.[Type],

    -- Paia vendute (somma per riga modello/colore)
    SUM(ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0))   AS PairsSold,

    -- Valore venduto (positivo per ordini, negativo per note credito)
    SUM(
        CASE sl.[Document Type]
            WHEN 1  THEN ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
                         - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0)
            WHEN -1 THEN -(ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
                           - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0))
            ELSE 0
        END
    )                                                               AS ValueSold,

    -- Costo unitario EXW/FOB
    exw.Costo,

    -- Costo totale = paia * costo unitario
    SUM(ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0)) * exw.Costo AS TotCosto,

    -- Margine lordo (valoreSold - costoTotale)
    SUM(
        CASE sl.[Document Type]
            WHEN 1  THEN ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
                         - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0)
            ELSE 0
        END
    ) - SUM(ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0)) * exw.Costo AS MargineGrosso

FROM [NewEra$Sales Header] sh
    INNER JOIN [NewEra$Sales Line] sl
        ON sh.[No_] = sl.[Document No_]
        AND sh.[Document Type] = sl.[Document Type]
    LEFT JOIN CostoEXWFOB exw
        ON sl.[Constant Variable Code] = exw.ColorCode
        AND sl.[No_] = exw.ArticleNo

WHERE sl.[Type] IN (19, 20)
  AND (sh.[No_] = @NumeroOrdine OR @NumeroOrdine IS NULL)

GROUP BY
    sh.[Bill-to Customer No_], sh.[Bill-to Name], sh.[No_],
    sl.[Delete Reason], sl.[Model Item No_], sl.[Variable Code 01],
    sl.[Currency Code], sl.[Type],
    sh.[Shortcut Dimension 1 Code], sh.[Shortcut Dimension 2 Code],
    sh.[Selling Season Code], exw.Costo

HAVING SUM(ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0)) > 0

ORDER BY sh.[No_], sl.[Model Item No_], sl.[Variable Code 01];
