-- ============================================================
-- QRY_007 — ConfrontoStagioniAvanzato
-- Fonte originale: def01-ANALISIVENDUTO-ConfrontoStagioni
-- Scopo: Analisi venduto con confronto tra 2 stagioni a data cut-off specifica
-- Parametri:
--   @Stagione1    VARCHAR(10)  — prima stagione  (era [forms]![principale]![filtroconfrontostagione1])
--   @CutOff1      DATE         — data cut-off S1 (era [forms]![principale]![datacutoffstagione1])
--   @Stagione2    VARCHAR(10)  — seconda stagione (era [forms]![principale]![filtroconfrontostagione2])
--   @CutOff2      DATE         — data cut-off S2  (era [forms]![principale]![datacutoffstagione2])
-- Note porting:
--   - La data '1753-01-01' e' il "null date" di NAV Business Central (minima data)
--   - TestOrdineAttivoAllaDataCutOff: ordine valido se ordinato entro cut-off E non cancellato dopo
--   - Dipende da def01-ANALISIVENDUTO-PIVOT che e' un wrapper sul PIVOT base
--   - Il PIVOT in Access usava il motore Jet interno; in T-SQL usare PIVOT o GROUP BY con CASE
-- ============================================================

WITH

-- Step 0: base vendite per articolo/colore/stagione con tutti i campi necessari
VenditePerPivot AS (
    SELECT
        sl.[Document Type],
        sl.[No_]                                AS Article,
        sl.[Constant Variable Code]             AS ColorCode,
        sl.[Assortment Code],
        sl.[Delete Reason],
        sl.[Delete Date],
        sh.[Order Date],
        sh.[Salesperson Code],
        sp.[Name]                               AS Salesperson,
        sh.[Sell-to Customer No_]               AS CustomerCode,
        c.[Name]                                AS CustomerName,
        i.[Season Code],
        i.[Trademark Code],
        i.[Line Code],
        vc.[Description]                        AS Color,
        ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0)            AS PairsQuantity,
        ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
            - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0) AS SalesValue

    FROM [NewEra$Sales Line] sl
        INNER JOIN [NewEra$Sales Header] sh
            ON sl.[Document Type] = sh.[Document Type]
            AND sl.[Document No_] = sh.[No_]
        LEFT JOIN [NewEra$Salesperson_Purchaser] sp ON sh.[Salesperson Code] = sp.[Code]
        LEFT JOIN [NewEra$Customer] c ON sh.[Sell-to Customer No_] = c.[No_]
        INNER JOIN [NewEra$Item] i ON sl.[No_] = i.[No_]
        LEFT JOIN [NewEra$Variable Code] vc
            ON sl.[Constant Variable Code] = vc.[Variable Code]

    WHERE sl.[Type] IN (19, 20)
      AND i.[Season Code] IN (@Stagione1, @Stagione2)
),

-- Aggiunta flag confronto stagioni con cut-off
ConfrontoConCutOff AS (
    SELECT
        *,

        -- Ordine attivo alla data cut-off (ordinato entro cut-off E non cancellato dopo)
        CASE
            WHEN (Season Code = @Stagione1
                  AND Order Date <= @CutOff1
                  AND (Delete Date = '1753-01-01' OR Delete Date IS NULL OR Delete Date > @CutOff1))
            OR   (Season Code = @Stagione2
                  AND Order Date <= @CutOff2
                  AND (Delete Date = '1753-01-01' OR Delete Date IS NULL OR Delete Date > @CutOff2))
            THEN 'ATTIVO'
            ELSE ''
        END                                                 AS TestOrdineAttivoAllaDataCutOff,

        -- Stagione presente (senza considerare cut-off)
        CASE
            WHEN Season Code IN (@Stagione1, @Stagione2)
            THEN 'ATTIVO'
            ELSE ''
        END                                                 AS TestStagione,

        -- Ordine ordinato entro cut-off (senza controllo delete)
        CASE
            WHEN (Season Code = @Stagione1 AND Order Date <= @CutOff1)
            OR   (Season Code = @Stagione2 AND Order Date <= @CutOff2)
            THEN 'ATTIVO'
            ELSE ''
        END                                                 AS TestDataOrdine,

        -- Parametri di riferimento esposti
        @Stagione1                                          AS StagioneConfronto1,
        @CutOff1                                            AS DataCutOffS1,
        @Stagione2                                          AS StagioneConfronto2,
        @CutOff2                                            AS DataCutOffS2

    FROM VenditePerPivot
)

SELECT * FROM ConfrontoConCutOff
ORDER BY Trademark Code, Season Code, SalespersonCode, CustomerCode, Article, ColorCode;

-- Nota: in Luke il filtro sull'attivita' (TestOrdineAttivoAllaDataCutOff = 'ATTIVO')
-- viene applicato lato client/frontend oppure come WHERE aggiuntivo nell'endpoint API
