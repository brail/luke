-- ============================================================
-- QRY_006 — ConfrontoStagioni
-- Fonte originale: confrontoStagioni-step0 + confrontoStagioni-step1
-- Scopo: Confronto paia/valore venduti per agente e cliente su 3 stagioni
-- Parametri:
--   @Stagione1  VARCHAR(10)  — prima stagione da confrontare  (era [forms]![principale]![FiltroStagione1])
--   @Stagione2  VARCHAR(10)  — seconda stagione               (era [forms]![principale]![FiltroStagione2])
--   @Stagione3  VARCHAR(10)  — terza stagione                 (era [forms]![principale]![FiltroStagione3])
-- Note porting:
--   - Il pattern IIf+SUM e' un crosstab manuale su 3 stagioni; in T-SQL usare CASE WHEN + GROUP BY
--   - [maschere]![principale] = alias obsoleto di [forms]![principale] in Access
--   - Il filtro delete_reason e' assente qui (incluse sia confermate che annullate)
--   - Il report finale filtra per CodiceAgente in WHERE esterno
-- ============================================================

WITH ConfrontoBase AS (
    SELECT
        sh.[Salesperson Code]                                       AS SalespersonCode,
        sp.[Name]                                                   AS Salesperson,
        sl.[Delete Reason],
        sh.[Sell-to Customer No_]                                   AS CustomerCode,
        c.[Name]                                                    AS CustomerName,
        i.[Season Code],

        -- Paia per stagione (IIF → CASE WHEN)
        CASE WHEN i.[Season Code] = @Stagione1
             THEN ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
             ELSE 0 END                                             AS PairsS1,
        CASE WHEN i.[Season Code] = @Stagione2
             THEN ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
             ELSE 0 END                                             AS PairsS2,
        CASE WHEN i.[Season Code] = @Stagione3
             THEN ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
             ELSE 0 END                                             AS PairsS3,

        -- Valore per stagione (Line Amount - Inv. Discount = valore netto)
        CASE WHEN i.[Season Code] = @Stagione1
             THEN ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
                  - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0)
             ELSE 0 END                                             AS SalesValueS1,
        CASE WHEN i.[Season Code] = @Stagione2
             THEN ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
                  - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0)
             ELSE 0 END                                             AS SalesValueS2,
        CASE WHEN i.[Season Code] = @Stagione3
             THEN ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
                  - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0)
             ELSE 0 END                                             AS SalesValueS3

    FROM [NewEra$Sales Line] sl
        INNER JOIN [NewEra$Sales Header] sh
            ON sl.[Document Type] = sh.[Document Type]
            AND sl.[Document No_] = sh.[No_]
        LEFT JOIN [NewEra$Salesperson_Purchaser] sp
            ON sh.[Salesperson Code] = sp.[Code]
        LEFT JOIN [NewEra$Customer] c
            ON sh.[Sell-to Customer No_] = c.[No_]
        INNER JOIN [NewEra$Item] i
            ON sl.[No_] = i.[No_]

    WHERE sl.[Type] IN (19, 20)
      AND i.[Season Code] IN (@Stagione1, @Stagione2, @Stagione3)
),

-- Aggregazione per agente e cliente (step1)
ConfrontoAggregato AS (
    SELECT
        SalespersonCode,
        Salesperson,
        CustomerCode,
        CustomerName,
        SUM(PairsS1)       AS PairsS1,
        SUM(SalesValueS1)  AS SalesValueS1,
        SUM(PairsS2)       AS PairsS2,
        SUM(SalesValueS2)  AS SalesValueS2,
        SUM(PairsS3)       AS PairsS3,
        SUM(SalesValueS3)  AS SalesValueS3
    FROM ConfrontoBase
    GROUP BY SalespersonCode, Salesperson, CustomerCode, CustomerName
)

SELECT
    *,
    -- Variazione % S1 → S2
    CASE WHEN PairsS1 > 0 THEN (PairsS2 - PairsS1) * 100.0 / PairsS1 ELSE NULL END AS DeltaPercPairsS1S2,
    CASE WHEN SalesValueS1 > 0 THEN (SalesValueS2 - SalesValueS1) * 100.0 / SalesValueS1 ELSE NULL END AS DeltaPercValueS1S2
FROM ConfrontoAggregato
ORDER BY SalespersonCode, CustomerCode;
