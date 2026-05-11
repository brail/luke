-- ============================================================
-- QRY_013 — TempiPagamento
-- Fonte originale: tempiPagQueryDefinitiva (via tempiPagBaseDocumentiDaVerificareQueryGenerale)
-- Scopo: Analisi tempi di pagamento effettivi vs scadenza, con classificazione per soglie
-- Parametri:
--   @SogliaGiorni    INT  — soglia giorni per classificare pagamento "veloce"
--                           (era [forms]![principale]![NumeroGiorniSoglia])
--   @SogliaRitardo   INT  — soglia giorni ritardo accettabile
--                           (era [forms]![principale]![NumeroGiorniSogliaRitardo])
--   @DataIniziale    DATE — inizio periodo fatture da analizzare
--   @DataFinale      DATE — fine periodo
--   @CodiceAgente    VARCHAR(20) — filtro agente (opzionale)
-- Note porting:
--   - DATEDIFF('d',...) in Access -> DATEDIFF(day,...) in T-SQL
--   - L'abbinamento fattura/pagamento avviene via Cust_ Ledger Entry e Detailed Cust_ Ledg_ Entry
--   - In NAV l'abbinamento e' nella colonna [Closed by Entry No_] o via [Applied-to Doc. Type]
--   - tempiPagDatiMarchiSuRigheFattureNDC: legge il marchio dalle righe fattura/NDC (UNION)
-- ============================================================

WITH

-- Marchi su fatture e note credito (fonte: righe dei documenti registrati)
MarchiDocumenti AS (
    SELECT [Document No_], MAX([Shortcut Dimension 2 Code]) AS DimMarchio
    FROM [NewEra$Sales Cr_Memo Line]
    GROUP BY [Document No_]

    UNION ALL

    SELECT [Document No_], MAX([Shortcut Dimension 2 Code]) AS DimMarchio
    FROM [NewEra$Sales Invoice Line]
    GROUP BY [Document No_]
),

-- Base: partite clienti (fatture + pagamenti abbinati)
PartiteBase AS (
    SELECT
        cle.[Customer No_]                                  AS CodiceCliente,
        cle.[Document No_]                                  AS NumeroDocumentoFattura,
        cle.[Document Type]                                 AS TipoDocumento,
        cle.[Document Date]                                 AS DataFattura,
        cle.[Due Date]                                      AS DataScadenzaPagamento,
        cle.[Salesperson Code]                              AS CodiceAgente,
        sp.[Name]                                           AS Agente,
        c.[Name]                                            AS Cliente,

        -- Dettaglio abbinamento pagamenti
        dcle.[Document No_]                                 AS NumeroDocumentoPagamento,
        dcle.[Document Date]                                AS DataPagamento,
        dcle.[Amount (LCY)]                                 AS ImportoAbbinatoCalcolato

    FROM [NewEra$Cust_ Ledger Entry] cle
        INNER JOIN [NewEra$Detailed Cust_ Ledg_ Entry] dcle
            ON cle.[Entry No_] = dcle.[Cust_ Ledger Entry No_]
            AND dcle.[Entry Type] = 2  -- 2 = Application (abbinamento)
        LEFT JOIN [NewEra$Salesperson_Purchaser] sp ON cle.[Salesperson Code] = sp.[Code]
        LEFT JOIN [NewEra$Customer] c ON cle.[Customer No_] = c.[No_]

    WHERE cle.[Document Type] IN (2, 3)  -- 2 = Invoice, 3 = Credit Memo
      AND cle.[Document Date] BETWEEN @DataIniziale AND @DataFinale
      AND (cle.[Salesperson Code] = @CodiceAgente OR @CodiceAgente IS NULL)
),

-- Calcolo giorni di pagamento
TempiPagamento AS (
    SELECT
        pb.*,
        DATEDIFF(day, pb.DataFattura, pb.DataPagamento)             AS GiorniPagamento,
        DATEDIFF(day, pb.DataScadenzaPagamento, pb.DataPagamento)   AS GiorniRitardo,

        -- Prodotti giorni x importo per calcolo DPO (days payable outstanding)
        DATEDIFF(day, pb.DataFattura, pb.DataPagamento)
            * pb.ImportoAbbinatoCalcolato                           AS GiorniPagamentoXImporto,
        DATEDIFF(day, pb.DataScadenzaPagamento, pb.DataPagamento)
            * pb.ImportoAbbinatoCalcolato                           AS GiorniRitardoXImporto,

        -- Etichette combinate per report
        pb.Cliente + ' (' + pb.CodiceCliente + ')'                  AS ClienteECodice,
        pb.Agente  + ' (' + pb.CodiceAgente + ')'                   AS AgenteECodice
    FROM PartiteBase pb
)

-- Query finale con classificazione per soglie
SELECT
    tp.*,
    md.DimMarchio                                                   AS Marchio,

    -- Importo entro soglia giorni di pagamento
    CASE WHEN tp.GiorniPagamento <= @SogliaGiorni
         THEN tp.ImportoAbbinatoCalcolato ELSE 0 END                AS ImportoEntroSoglia,

    -- Importo entro soglia ritardo
    CASE WHEN tp.GiorniRitardo <= @SogliaRitardo
         THEN tp.ImportoAbbinatoCalcolato ELSE 0 END                AS ImportoEntroSogliaRitardo

FROM TempiPagamento tp
    LEFT JOIN MarchiDocumenti md ON tp.NumeroDocumentoFattura = md.[Document No_]

ORDER BY tp.DataFattura, tp.CodiceCliente;
