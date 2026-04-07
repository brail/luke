-- ============================================================
-- QRY_008 — AnnullamentiPerAgente
-- Fonte originale: AnnullamentiAgenteCliente
-- Scopo: Confronto paia/valore annullati vs confermati per agente/cliente/articolo
-- Parametri:
--   @Marchio       VARCHAR(20)  — marchio (filtro applicato nel report Access)
--   @Stagione      VARCHAR(10)  — stagione
--   @CodiceAgente  VARCHAR(20)  — codice agente (opzionale; NULL = tutti gli agenti)
-- Note porting:
--   - delete_reason = 'art' = annullamento per motivo articolo
--   - delete_reason = '' o NULL = ordine confermato attivo
--   - Dipende da def01-ANALISIVENDUTO-PIVOT che e' un wrapper sulla query base pivot
--   - In Luke: usare CASE WHEN + SUM al posto di IIF
-- ============================================================

WITH VenditeBase AS (
    SELECT
        i.[Season Code]                                         AS Stagione,
        i.[Trademark Code]                                      AS Marchio,
        sh.[Salesperson Code]                                   AS CodiceAgente,
        sp.[Name]                                               AS Agente,
        sh.[Sell-to Customer No_]                               AS CodiceCliente,
        c.[Name]                                                AS Cliente,
        i.[Line Code]                                           AS Linea,
        sl.[No_]                                               AS Articolo,
        sl.[Constant Variable Code]                            AS CodiceColore,
        vc.[Description]                                       AS Colore,
        sl.[Delete Reason],
        ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0) AS PairsQuantity,
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
      AND i.[Season Code]    = @Stagione
      AND i.[Trademark Code] = @Marchio
      AND (sh.[Salesperson Code] = @CodiceAgente OR @CodiceAgente IS NULL)
)

SELECT
    Stagione,
    Marchio,
    CodiceAgente,
    Agente,
    CodiceCliente,
    Cliente,
    Linea,
    Articolo,
    CodiceColore,
    Colore,

    -- Paia annullate (delete_reason = 'art')
    SUM(CASE WHEN Delete Reason = 'art' THEN PairsQuantity ELSE 0 END) AS PaiaAnnullate,
    SUM(CASE WHEN Delete Reason = 'art' THEN SalesValue ELSE 0 END)    AS ValoreAnnullato,

    -- Paia confermate (delete_reason vuoto o NULL)
    SUM(CASE WHEN Delete Reason = '' OR Delete Reason IS NULL THEN PairsQuantity ELSE 0 END) AS PaiaConfermate,
    SUM(CASE WHEN Delete Reason = '' OR Delete Reason IS NULL THEN SalesValue ELSE 0 END)    AS ValoreConfermato,

    -- % annullamenti
    CASE
        WHEN SUM(CASE WHEN Delete Reason = '' OR Delete Reason IS NULL THEN PairsQuantity ELSE 0 END) > 0
        THEN SUM(CASE WHEN Delete Reason = 'art' THEN PairsQuantity ELSE 0 END) * 100.0
             / SUM(CASE WHEN Delete Reason = '' OR Delete Reason IS NULL THEN PairsQuantity ELSE 0 END)
        ELSE NULL
    END AS PercAnnullamenti

FROM VenditeBase
GROUP BY
    Stagione, Marchio, CodiceAgente, Agente, CodiceCliente, Cliente,
    Linea, Articolo, CodiceColore, Colore

ORDER BY CodiceAgente, CodiceCliente, Linea, Articolo, CodiceColore;
