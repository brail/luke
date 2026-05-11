-- ============================================================
-- QRY_025 — AnalisiNoteCreditoEResi
-- Fonte originale: def01-ANALISINOTEDICREDITO-PIVOT
-- Scopo: Note di credito e resi con classificazione articolo completa per analisi pattern resi
-- Parametri:
--   @Stagione  VARCHAR(10)  — stagione (opzionale)
--   @Marchio   VARCHAR(20)  — marchio  (opzionale)
--   @DataDa    DATE         — data inizio (filtro su Posting Date NDC)
--   @DataA     DATE         — data fine
-- Note porting:
--   - Include sia NDC da Sales Cr_Memo (registrate) che resi da Sales Header (tipo -1)
--   - La classificazione articolo e' molto dettagliata: include Heel Height, Market Segment,
--     Innovation Degree — tutti campi custom NewEra su Item
--   - Geographical Zone e' la zona del cliente (non dell'articolo)
-- ============================================================

WITH

-- Note credito registrate con attributi
NoteCreditoRegistrate AS (
    SELECT
        scmh.[No_]                                          AS NumeroDocumento,
        'NDC_REGISTRATA'                                    AS TipoDocumento,
        scmh.[Posting Date]                                 AS DataRegistrazione,
        scmh.[Bill-to Customer No_]                        AS CodiceCliente,
        scmh.[Bill-to Name]                                AS NomeCliente,
        scmh.[Shortcut Dimension 2 Code]                   AS Marchio,
        scmh.[Selling Season Code]                         AS Stagione,
        scmh.[Salesperson Code],
        scml.[No_]                                         AS Articolo,
        scml.[Model Item No_]                              AS ArticoloModello,
        scml.[Variable Code 01]                            AS CodiceColore,
        scml.[Constant Variable Code]                      AS CodiceAssortimento,
        scml.[Geographical Zone]                           AS ZonaGeografica,
        ISNULL(TRY_CAST(scml.[No_ of Pairs] AS DECIMAL(18,4)), 0) AS Paia,
        ISNULL(TRY_CAST(scml.[Line Amount] AS DECIMAL(18,4)), 0)
            - ISNULL(TRY_CAST(scml.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0) AS Valore,
        scml.[Reason Code]                                 AS CodiceMotivo

    FROM [NewEra$Sales Cr_Memo Line] scml
        INNER JOIN [NewEra$Sales Cr_Memo Header] scmh ON scml.[Document No_] = scmh.[No_]
    WHERE scml.[Type] IN (19, 20)
),

-- Resi da ordini (Sales Header tipo -1 o return orders)
ResiDaOrdini AS (
    SELECT
        sh.[No_]                                            AS NumeroDocumento,
        'RESO_ORDINE'                                       AS TipoDocumento,
        sh.[Document Date]                                  AS DataRegistrazione,
        sh.[Bill-to Customer No_]                          AS CodiceCliente,
        sh.[Bill-to Name]                                  AS NomeCliente,
        sh.[Shortcut Dimension 2 Code]                     AS Marchio,
        sh.[Selling Season Code]                           AS Stagione,
        sh.[Salesperson Code],
        sl.[No_]                                           AS Articolo,
        sl.[Model Item No_]                                AS ArticoloModello,
        sl.[Variable Code 01]                              AS CodiceColore,
        sl.[Constant Variable Code]                        AS CodiceAssortimento,
        sl.[Geographical Zone]                             AS ZonaGeografica,
        ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0) AS Paia,
        -(ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
          - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0)) AS Valore,
        sl.[Reason Code]                                   AS CodiceMotivo

    FROM [NewEra$Sales Line] sl
        INNER JOIN [NewEra$Sales Header] sh
            ON sl.[Document Type] = sh.[Document Type]
            AND sl.[Document No_] = sh.[No_]
    WHERE sl.[Type] IN (19, 20)
      AND sh.[Document Type] = -1                          -- return orders (verificare valore)
),

-- Union NDC + resi
TutteLeNDC AS (
    SELECT * FROM NoteCreditoRegistrate
    UNION ALL
    SELECT * FROM ResiDaOrdini
)

SELECT
    n.*,
    gz.[Description]                                       AS DescrizioneZonaGeo,
    -- Classificazione articolo dettagliata
    i.[Trademark Code]                                     AS MarchioArticolo,
    i.[Season Code]                                        AS StagioneArticolo,
    i.[Collection Code],
    i.[Line Code]                                          AS Linea,
    i.[Season Typology],
    i.[Product Family]                                     AS FamigliaProdotto,
    i.[Product Sex]                                        AS GenereProdotto,
    i.[Shipment Priority],
    -- Campi custom NewEra su Item (verificare presenza in FEBOS_10)
    i.[Innovation Degree],
    i.[Heel Height],
    i.[End Customer Price Gap],
    i.[Market Segment],
    i.[Product Typology],
    i.[Main Material],
    i.[Sole Material]

FROM TutteLeNDC n
    LEFT JOIN [NewEra$Geographical Zone] gz ON n.ZonaGeografica = gz.[Geographical Zone]
    INNER JOIN [NewEra$Item] i ON n.Articolo = i.[No_]

WHERE (n.Stagione = @Stagione OR @Stagione IS NULL)
  AND (n.Marchio  = @Marchio  OR @Marchio IS NULL)
  AND (n.DataRegistrazione BETWEEN @DataDa AND @DataA OR @DataDa IS NULL)

ORDER BY n.DataRegistrazione, n.NumeroDocumento, n.Articolo;
