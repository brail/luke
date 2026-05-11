-- ============================================================
-- QRY_005 — MiglioriArticoliVenduti
-- Fonte originale: GraficoMiglioriArticoliVenduti (via GraficoMiglioriArticoliVenduti-step0)
-- Scopo: Ranking articoli venduti per stagione/marchio con immagini, listini wholesale e retail
-- Parametri:
--   @Stagione    VARCHAR(10)  — stagione di vendita (filtro in WHERE)
--   @Marchio     VARCHAR(20)  — marchio (filtro in WHERE)
--   @Moltiplicatore DECIMAL(5,2) — fattore gonfiamento paia per proiezioni (1.0 = nessuna modifica)
--                                  era letto da tabella locale Access "Marchi"
-- Note porting:
--   - Il "moltiplicatore" in step0 era letto dalla tabella locale Access "Marchi"
--     (PercentualeMargineMarchio o MoltiplicatorePrezzoAlPubblicoMarchio)
--     In Luke usare il valore da PricingParameterSet o come parametro API
--   - DatiCarryOverESMU: tabella locale Access da valutare
--   - Immagini: [External Linked Documents] con Source Type=4, Document Type=5
--   - STRING_AGG sostituisce la funzione VBA custom append()
--   - La funzione append() realizza una concatenazione stateful "per gruppo" (memo pattern)
-- ============================================================

WITH

-- Step 0: ordini di vendita base (solo ordini attivi, non note credito)
VenditeStep0 AS (
    SELECT
        sl.[Document Type],
        i.[Line Code]                                           AS Linea,
        sl.[No_]                                               AS Articolo,
        sl.[Constant Variable Code]                            AS CodiceColore,
        vc.[Description]                                       AS Colore,
        i.[Trademark Code]                                     AS Marchio,
        sh.[Selling Season Code]                               AS Stagione,
        sl.[Delete Reason],
        i.[Description]                                        AS Descrizione,
        i.[Description 2]                                      AS Descrizione2,
        i.[Product Family]                                     AS FamigliaProdotto,
        i.[Product Sex]                                        AS GenereProdotto,
        i.[Collection Code],
        i.[Vendor No_],
        vend.[Name]                                            AS VendorName,
        vend1.[No_]                                           AS Manufacturer,
        vend1.[Name]                                          AS ManufacturerName,

        -- Paia confermate (delete_reason vuoto o NULL)
        SUM(CASE
            WHEN sl.[Delete Reason] = '' OR sl.[Delete Reason] IS NULL
            THEN ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
            ELSE 0
        END)                                                   AS PaiaConfermateREAL

    FROM [NewEra$Sales Line] sl
        INNER JOIN [NewEra$Item] i       ON sl.[No_] = i.[No_]
        INNER JOIN [NewEra$Variable Code] vc
            ON sl.[Constant Variable Code] = vc.[Variable Code]
            AND sl.[Constant Assortment Var_Grp_] = vc.[Variable Group]
        LEFT JOIN [NewEra$Vendor] vend   ON i.[Vendor No_] = vend.[No_]
        LEFT JOIN [NewEra$Vendor] vend1  ON i.[Manufacturer] = vend1.[No_]
        INNER JOIN [NewEra$Sales Header] sh ON sl.[Document No_] = sh.[No_]

    WHERE sl.[Type] IN (19, 20)         -- articoli modello e assortimento
      AND sl.[Document Type] = 1        -- ordini (non note credito)
      AND i.[Advertising Material] = 0  -- escludi campionari
      AND sh.[Selling Season Code] = @Stagione
      AND i.[Trademark Code] = @Marchio

    GROUP BY
        sl.[Document Type], i.[Line Code], sl.[No_], sl.[Constant Variable Code],
        vc.[Description], i.[Trademark Code], sh.[Selling Season Code], sl.[Delete Reason],
        i.[Description], i.[Description 2], i.[Product Family], i.[Product Sex],
        i.[Collection Code], i.[Vendor No_], vend.[Name], vend1.[No_], vend1.[Name]
),

-- Paia totali per linea (per calcolo % peso per linea)
PaiaPerLinea AS (
    SELECT
        VendorName,
        Linea,
        SUM(PaiaConfermateREAL) AS PaiaPerLinea
    FROM VenditeStep0
    GROUP BY VendorName, Linea
),

-- Paia totali per articolo (per calcolo % peso per articolo)
PaiaPerArticolo AS (
    SELECT
        Articolo,
        SUM(PaiaConfermateREAL) AS PaiaPerArticolo
    FROM VenditeStep0
    GROUP BY Articolo
),

-- Listino Wholesale aggregato per articolo/colore
ListinoWholesale AS (
    SELECT
        sp.[Item No_]                           AS ArticleNo,
        sp.[Variant Code]                       AS ColorCode,
        STRING_AGG(
            '(' + FORMAT(sp.[Unit Price], 'N2') + ')',
            ','
        ) WITHIN GROUP (ORDER BY sp.[Currency Code]) AS ListinoWholesale
    FROM [NewEra$Sales Price] sp
    WHERE sp.[Sales Type] = 0                   -- tutti i clienti
      AND sp.[Price Type] = 0                   -- wholesale
    GROUP BY sp.[Item No_], sp.[Variant Code]
),

-- Listino Retail aggregato per articolo/colore
ListinoRetail AS (
    SELECT
        sp.[Item No_]                           AS ArticleNo,
        sp.[Variant Code]                       AS ColorCode,
        STRING_AGG(
            '(' + FORMAT(sp.[Unit Price], 'N2') + ')',
            ','
        ) WITHIN GROUP (ORDER BY sp.[Currency Code]) AS ListinoRetail
    FROM [NewEra$Sales Price] sp
    WHERE sp.[Sales Type] = 0
      AND sp.[Price Type] = 1                   -- retail
    GROUP BY sp.[Item No_], sp.[Variant Code]
),

-- Immagini collegate agli articoli
Immagini AS (
    SELECT
        [Source No_]              AS ArticleNo,
        [Constant Variable Code]  AS ColorCode,
        [Linked Document]         AS LinkImmagine
    FROM [NewEra$External Linked Documents]
    WHERE [Source Type] = 4       -- Item
      AND [Document Type] = 5     -- Image (verificare il codice esatto in FEBOS_10)
)

-- === Query finale ===
SELECT
    s.*,

    -- Paia con moltiplicatore (se <> 1 si arrotonda a decine)
    CASE
        WHEN @Moltiplicatore <> 1
        THEN ROUND(s.PaiaConfermateREAL * @Moltiplicatore / 10, 0) * 10
        ELSE s.PaiaConfermateREAL
    END                                         AS PaiaConfermate,

    -- Peso % per linea
    pl.PaiaPerLinea,
    CASE WHEN pl.PaiaPerLinea > 0
         THEN s.PaiaConfermateREAL / pl.PaiaPerLinea ELSE 0 END AS PesoPercLinea,

    -- Peso % per articolo
    pa.PaiaPerArticolo,
    CASE WHEN pa.PaiaPerArticolo > 0
         THEN s.PaiaConfermateREAL / pa.PaiaPerArticolo ELSE 0 END AS PesoPercArticolo,

    -- Listini
    lw.ListinoWholesale,
    lr.ListinoRetail,

    -- Immagine (URL o path)
    img.LinkImmagine

    -- Nota: DatiCarryOverESMU (Carry Over flag) da aggiungere se disponibile in Luke
    -- , co.[Carry Over]

FROM VenditeStep0 s
    LEFT JOIN PaiaPerLinea pl   ON s.VendorName = pl.VendorName AND s.Linea = pl.Linea
    LEFT JOIN PaiaPerArticolo pa ON s.Articolo = pa.Articolo
    LEFT JOIN ListinoWholesale lw ON s.Articolo = lw.ArticleNo AND s.CodiceColore = lw.ColorCode
    LEFT JOIN ListinoRetail lr   ON s.Articolo = lr.ArticleNo AND s.CodiceColore = lr.ColorCode
    LEFT JOIN Immagini img       ON s.Articolo = img.ArticleNo AND s.CodiceColore = img.ColorCode

ORDER BY PaiaConfermate DESC, s.Linea, s.Articolo, s.CodiceColore;
