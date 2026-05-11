-- ============================================================
-- QRY_020 — BilancioPerSorgente
-- Fonte originale: BilancioPerSorgente
-- Scopo: Movimenti CoGe su conti ricavi con dimensioni (CCR, Marchio, Stagione, Linea)
-- Parametri:
--   @DataIniziale    DATE         — inizio periodo
--   @DataFinale      DATE         — fine periodo
--   @FiltroConti     VARCHAR(10)  — prefisso conti CoGe (default 'R' = ricavi)
-- Note porting:
--   - Dimensioni_NE e' una vista/query Access che legge da Dimension Set Entry
--     con le dimensioni NewEra-specifiche (CCR, Marchio, Stagione, Linea)
--     In Luke creare una vista equivalente su [Dimension Set Entry]
--   - Source Type in G_L Entry: 1=Customer, 2=Vendor, 3=Bank Account
--   - Filtro su conti inizianti per 'R': LIKE 'R%' in T-SQL
-- ============================================================

WITH

-- Vista dimensioni NewEra (equivalente di Dimensioni_NE in Access)
-- Questa CTE aggrega tutte le dimensioni di un Dimension Set ID in colonne pivot
DimensioniNE AS (
    SELECT
        dse.[Dimension Set ID],
        MAX(CASE WHEN dse.[Dimension Code] = 'CCR'     THEN dse.[Dimension Value Code] END) AS CCR,
        MAX(CASE WHEN dse.[Dimension Code] = 'MARCHIO' THEN dse.[Dimension Value Code] END) AS MARCHIO,
        MAX(CASE WHEN dse.[Dimension Code] = 'STAGIONE'THEN dse.[Dimension Value Code] END) AS STAGIONE,
        MAX(CASE WHEN dse.[Dimension Code] = 'LINEA'   THEN dse.[Dimension Value Code] END) AS LINEA
    FROM [NewEra$Dimension Set Entry] dse
    GROUP BY dse.[Dimension Set ID]
)

SELECT
    gle.[Source Code],
    gle.[Source Type],
    gle.[Source No_],
    gle.[Document No_],
    gle.[Description],
    ISNULL(TRY_CAST(gle.[Amount] AS DECIMAL(18,4)), 0)  AS Importo,
    gle.[G_L Account No_],
    gla.[Name]                                           AS Conto,
    vend.[Name]                                          AS Fornitore,
    cust.[Name]                                          AS Cliente,
    gle.[Posting Date]                                   AS DataRegistrazione,
    dim.CCR,
    dim.MARCHIO                                          AS Marchio,
    dim.STAGIONE                                         AS Stagione,
    dim.LINEA                                            AS Linea

FROM [NewEra$G_L Entry] gle
    LEFT JOIN DimensioniNE dim ON gle.[Dimension Set ID] = dim.[Dimension Set ID]
    LEFT JOIN [NewEra$G_L Account] gla ON gle.[G_L Account No_] = gla.[No_]
    LEFT JOIN [NewEra$Vendor] vend ON gle.[Source No_] = vend.[No_]
        AND gle.[Source Type] = 2   -- Vendor
    LEFT JOIN [NewEra$Customer] cust ON gle.[Source No_] = cust.[No_]
        AND gle.[Source Type] = 1   -- Customer

WHERE gle.[G_L Account No_] LIKE @FiltroConti + '%'  -- default: 'R' per conti ricavi
  AND gle.[Posting Date] BETWEEN @DataIniziale AND @DataFinale

ORDER BY gle.[Posting Date], gle.[G_L Account No_], gle.[Source No_];
