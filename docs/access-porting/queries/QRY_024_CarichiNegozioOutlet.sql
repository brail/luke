-- ============================================================
-- QRY_024 — CarichiNegozioOutlet
-- Fonte originale: CarichiNegozioOutletDaDdt
-- Scopo: Carichi negozio outlet da DDT con EAN code per monitoraggio merce verso canale outlet
-- Parametri:
--   @NumeroDDT  VARCHAR(20)  — numero DDT da analizzare
--                               era [Forms]![Principale]![FiltroDDTPerNegozioOutlet]
-- Note porting:
--   - Questo e' un filtro per singolo DDT; per analisi aggregate omettere il filtro
--   - EANCodes e' la tabella dei codici EAN (cross-reference) in NAV
--   - Type=2 nelle righe DDT = assortimento
-- ============================================================

SELECT
    'Carico'                                               AS TipoMovimento,
    ddth.[No_]                                            AS NoDocumento,
    ddth.[Posted Date]                                    AS DataVendita,
    ean.[Cross-Reference No_]                             AS EANCode,
    ISNULL(TRY_CAST(ddtl.[Quantity] AS DECIMAL(18,4)), 0) AS Quantita,
    ddtl.[Model Item No_]                                 AS Articolo,
    ddtl.[Variable Code 01]                               AS Colore,
    ddtl.[Variable Code 02]                               AS Taglia,
    i.[Trademark Code]                                    AS Marchio,
    i.[Season Code]                                       AS Stagione

FROM [NewEra$DDT_Picking Header] ddth
    INNER JOIN [NewEra$DDT_Picking Line] ddtl ON ddth.[No_] = ddtl.[Document No_]
    LEFT JOIN [NewEra$Item Cross Reference] ean ON ddtl.[No_] = ean.[Item No_]
        AND ean.[Cross-Reference Type] = 3              -- tipo EAN/Barcode (verificare codice)
    INNER JOIN [NewEra$Item] i ON ddtl.[No_] = i.[No_]

WHERE ddth.[No_] = @NumeroDDT
  AND ddtl.[Type] = 2                                    -- assortimento

ORDER BY ddtl.[Line No_];
