-- ============================================================
-- QRY_022 — VenditeEPrenotazioni
-- Fonte originale: VenditeEPrenotazioni (via VenditeEPrenotazioni-preExport)
-- Scopo: Portafoglio ordini attivi con prenotazioni di trasferimento e copertura disponibilita'
-- Parametri:
--   @Stagione  VARCHAR(10)  — stagione (obbligatorio — query molto pesante senza filtro)
-- Note porting:
--   - In Access era suddivisa in molti step: ordini aperti, in bolla aperta, in bolla rilasciata,
--     prenotato da trasferimento; questa e' una versione semplificata
--   - Il "Totale Coperto" era calcolato in una tabella di staging (VBA loop)
--     In Luke calcolarlo inline come CTE
--   - La struttura e': venduto (ordini) + spedito (bolla aperta) + spedito (bolla rilasciata) + prenotato
-- ============================================================

WITH

-- Ordini di vendita confermati
OrdiniAttivi AS (
    SELECT
        sl.[No_]                                            AS ArticleNo,
        sl.[Constant Variable Code]                        AS ColorCode,
        sl.[Assortment Code],
        i.[Season Code],
        i.[Trademark Code],
        i.[Line Code],

        SUM(CASE WHEN sl.[Delete Reason] = '' OR sl.[Delete Reason] IS NULL
                 THEN ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0) ELSE 0 END) AS PaiaOrdinate,

        SUM(CASE WHEN sl.[Delete Reason] = '' OR sl.[Delete Reason] IS NULL
                 THEN ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0) ELSE 0 END) AS AssortimentiOrdinate

    FROM [NewEra$Sales Line] sl
        INNER JOIN [NewEra$Item] i ON sl.[No_] = i.[No_]
    WHERE sl.[Type] IN (19, 20)
      AND sl.[Document Type] = 1
      AND i.[Season Code] = @Stagione
    GROUP BY sl.[No_], sl.[Constant Variable Code], sl.[Assortment Code],
             i.[Season Code], i.[Trademark Code], i.[Line Code]
),

-- DDT aperti (bolla aperta = spedito ma non ancora registrato)
BolleAperte AS (
    SELECT
        ddtl.[No_]                                         AS ArticleNo,
        ddtl.[Constant Variable Code]                      AS ColorCode,
        ddtl.[Assortment Code],
        SUM(ISNULL(TRY_CAST(ddtl.[Quantity] AS DECIMAL(18,4)), 0)) AS PaiaBollaAperta
    FROM [NewEra$DDT_Picking Line] ddtl
        INNER JOIN [NewEra$DDT_Picking Header] ddth ON ddtl.[Document No_] = ddth.[No_]
    WHERE ddth.[Status] = 0   -- 0 = aperto (non ancora registrato)
      AND ddth.[Document Type] = 0
      AND ddtl.[Type] IN (19, 20)
    GROUP BY ddtl.[No_], ddtl.[Constant Variable Code], ddtl.[Assortment Code]
),

-- DDT rilasciati (bolla rilasciata = in fase di picking)
BolleRilasciate AS (
    SELECT
        ddtl.[No_]                                         AS ArticleNo,
        ddtl.[Constant Variable Code]                      AS ColorCode,
        ddtl.[Assortment Code],
        SUM(ISNULL(TRY_CAST(ddtl.[Quantity] AS DECIMAL(18,4)), 0)) AS PaiaBollaRilasciata
    FROM [NewEra$DDT_Picking Line] ddtl
        INNER JOIN [NewEra$DDT_Picking Header] ddth ON ddtl.[Document No_] = ddth.[No_]
    WHERE ddth.[Status] = 1   -- 1 = rilasciato (picking in corso)
      AND ddth.[Document Type] = 0
      AND ddtl.[Type] IN (19, 20)
    GROUP BY ddtl.[No_], ddtl.[Constant Variable Code], ddtl.[Assortment Code]
)

SELECT
    oa.Season Code                                         AS Stagione,
    oa.Trademark Code                                      AS Marchio,
    oa.Line Code                                           AS Linea,
    oa.ArticleNo                                           AS Articolo,
    oa.ColorCode                                           AS CodiceColore,
    oa.AssortmentCode,
    oa.PaiaOrdinate,
    oa.AssortimentiOrdinate,
    ISNULL(ba.PaiaBollaAperta, 0)                          AS PaiaBollaAperta,
    ISNULL(br.PaiaBollaRilasciata, 0)                      AS PaiaBollaRilasciata,

    -- Totale coperto = bolla aperta + bolla rilasciata
    ISNULL(ba.PaiaBollaAperta, 0) + ISNULL(br.PaiaBollaRilasciata, 0) AS PaiaTotaleCoperto,

    -- Residuo ancora da coprire
    GREATEST(0, oa.PaiaOrdinate
               - ISNULL(ba.PaiaBollaAperta, 0)
               - ISNULL(br.PaiaBollaRilasciata, 0)) AS PaiaResidue

FROM OrdiniAttivi oa
    LEFT JOIN BolleAperte ba
        ON oa.ArticleNo = ba.ArticleNo AND oa.ColorCode = ba.ColorCode AND oa.AssortmentCode = ba.AssortmentCode
    LEFT JOIN BolleRilasciate br
        ON oa.ArticleNo = br.ArticleNo AND oa.ColorCode = br.ColorCode AND oa.AssortmentCode = br.AssortmentCode

ORDER BY Stagione, Marchio, Linea, Articolo, CodiceColore;
