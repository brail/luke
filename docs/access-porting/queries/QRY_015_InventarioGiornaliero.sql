-- ============================================================
-- QRY_015 — InventarioGiornaliero (serie storica)
-- Fonte originale: InventarioAllaData-PerGiacenzaGiornaliera (Procedure Access)
-- Scopo: Giacenza cumulata per marchio/stagione/locazione per ogni giorno del periodo
-- Parametri:
--   @DataIniziale  DATE  — inizio serie storica
--   @DataFinale    DATE  — fine serie storica
-- Note porting:
--   - In Access era un INSERT in loop giornaliero (VBA chiudeva la query per ogni data)
--   - In T-SQL usare una date series CTE per evitare il loop
--   - Configurator Relation = 3: filtra solo articoli normali (non varianti configurate)
--     Verificare con business il significato esatto di questo valore in NewEra
--   - Advertising Material = 0: esclude campionari
--   - La giacenza e' CUMULATA: tutti i movimenti con Posting Date <= DataInventario
-- ============================================================

WITH

-- Generazione serie di date (da @DataIniziale a @DataFinale)
DateSeries AS (
    SELECT @DataIniziale AS DataInventario
    UNION ALL
    SELECT DATEADD(day, 1, DataInventario)
    FROM DateSeries
    WHERE DataInventario < @DataFinale
),

-- Movimenti di magazzino con attributi articolo
MovimentiMagazzino AS (
    SELECT
        ile.[Posting Date],
        ile.[Location Code],
        i.[Trademark Code],
        i.[Season Code],
        ISNULL(TRY_CAST(ile.[Quantity] AS DECIMAL(18,4)), 0) AS Quantity
    FROM [NewEra$Item Ledger Entry] ile
        INNER JOIN [NewEra$Item] i ON ile.[Item No_] = i.[No_]
    WHERE i.[Advertising Material] = 0
      AND i.[Configurator Relation] = 3  -- solo articoli normali (verificare valore)
      AND ile.[Posting Date] <= @DataFinale  -- pre-filtro per performance
),

-- Giacenza cumulata per ogni data x marchio x stagione x locazione
GiacenzaGiornaliera AS (
    SELECT
        ds.DataInventario,
        mm.[Trademark Code],
        mm.[Season Code],
        mm.[Location Code],
        SUM(mm.Quantity) AS Paia

    FROM DateSeries ds
        CROSS JOIN (
            SELECT DISTINCT [Trademark Code], [Season Code], [Location Code]
            FROM MovimentiMagazzino
        ) dims
        INNER JOIN MovimentiMagazzino mm
            ON mm.[Trademark Code] = dims.[Trademark Code]
            AND mm.[Season Code]   = dims.[Season Code]
            AND mm.[Location Code] = dims.[Location Code]
            AND mm.[Posting Date] <= ds.DataInventario

    GROUP BY ds.DataInventario, mm.[Trademark Code], mm.[Season Code], mm.[Location Code]

    HAVING SUM(mm.Quantity) <> 0  -- escludi locazioni con giacenza zero
)

SELECT
    DataInventario,
    [Trademark Code] AS Marchio,
    [Season Code]    AS Stagione,
    [Location Code]  AS Locazione,
    Paia
FROM GiacenzaGiornaliera
ORDER BY DataInventario, Marchio, Stagione, Locazione

OPTION (MAXRECURSION 3650);  -- supporta serie fino a 10 anni; adeguare se necessario
