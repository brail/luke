-- ============================================================
-- QRY_012 — AnalisiCreditoAnomalieOrdini
-- Fonte originale: AnalisiCredito-RicercaAnomalie
-- Scopo: Analisi rischio credito per ordini di vendita con dati fido Cerved/Cribis e flag anomalia
-- Parametri:
--   @StagioneDaAnalizzare  VARCHAR(10)  — stagione corrente (era [forms]![principale]![creditofiltrostagione2])
-- Note porting:
--   - I campi Anomalous, Checked, Current Risk, Risk Rating, Credit Limit, Risk Rating
--     sono campi CUSTOM di NewEra su [Customer] e [Sales Header] — verificare presenza in FEBOS_10
--   - Val([credit limit]) = ISNULL(TRY_CAST([credit limit] AS DECIMAL), 0)
--     perche' in NAV questi campi Cerved/Cribis sono stringhe
--   - [Credit Limit (LCY)] e' il fido standard NAV; [credit limit] e' quello Cerved (custom)
--   - [creditlimit] (senza spazio) e' il fido Cribis (altro campo custom)
--   - La query originale aggregava anche valori ordini di due stagioni diverse in uno stesso SELECT
-- ============================================================

WITH OrdiniConCredito AS (
    SELECT
        sh.[Document Type],
        sh.[No_]                                            AS OrderNo,
        sh.[Sell-to Customer No_],
        sh.[Salesperson Code]                               AS SalesPersonCode,
        sp.[Name]                                           AS SalesPersonName,
        sh.[Selling Season Code]                            AS SeasonCode,
        sh.[Payment Method Code]                            AS MetodoPagamentoOrdine,
        sh.[Payment Terms Code]                             AS CondizioniPagamentoOrdine,
        sl.[Delete Reason],
        sl.[Currency Code],

        -- Dati cliente
        c.[Name],
        c.[Name 2],
        c.[Address],
        c.[Post Code],
        c.[City],
        c.[County],
        c.[Country_Region Code],
        c.[VAT Registration No_],
        c.[Fiscal Code],
        c.[Purchase Group],
        c.[Payment Method Code]                             AS MetodoPagamentoCliente,
        c.[Payment Terms Code]                              AS CondizioniPagamentoCliente,
        c.[Blocked for Assignments],

        -- Dati credito standard NAV
        ISNULL(TRY_CAST(c.[Credit Limit (LCY)] AS DECIMAL(18,2)), 0) AS FidoNAV,

        -- Dati credito CUSTOM NewEra (campi stringa in NAV)
        -- ATTENZIONE: verificare presenza di questi campi in FEBOS_10
        ISNULL(TRY_CAST(c.[Current Risk] AS VARCHAR(50)), '')         AS CurrentRisk,
        ISNULL(TRY_CAST(c.[Credit Limit] AS DECIMAL(18,2)), 0)        AS FidoCerved,
        ISNULL(TRY_CAST(c.[Risk Rating] AS VARCHAR(50)), '')           AS RatingCerved,
        -- c.[creditlimit] (Cribis) -- verificare nome campo esatto
        c.[Updated Date]                                    AS DataAggiornamento,
        c.[Due Date]                                        AS DataValutazione,

        -- Dati anomalia ordine (campi CUSTOM su Sales Header)
        -- ATTENZIONE: verificare presenza di questi campi in FEBOS_10
        -- sh.[Anomalous]                                   AS IsAnomalo,
        -- sh.[Anomalous Date]                              AS DataAnomalia,
        -- sh.[Checked]                                     AS IsVerificato,
        -- sh.[Checked Date]                                AS DataVerifica,

        -- Zona geografica e credit manager
        gz.[Credit Manager],
        gz.[Description]                                    AS GeographicalZoneDescription,
        gz.[Geographical Zone]                              AS GeographicalZone2,

        -- Valore ordine
        SUM(
            CASE
                WHEN sh.[Selling Season Code] = @StagioneDaAnalizzare
                     AND sl.[Document Type] = 1  -- ordine
                THEN ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
                     - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0)
                ELSE 0
            END
        )                                                   AS ValoreOrdineStagioneCorrente,

        SUM(
            CASE
                WHEN sl.[Document Type] = -1  -- nota credito
                THEN -(ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0)
                       - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0))
                ELSE 0
            END
        )                                                   AS ValoreNDC

    FROM [NewEra$Sales Header] sh
        INNER JOIN [NewEra$Sales Line] sl
            ON sh.[No_] = sl.[Document No_]
            AND sh.[Document Type] = sl.[Document Type]
        INNER JOIN [NewEra$Customer] c ON sh.[Sell-to Customer No_] = c.[No_]
        LEFT JOIN [NewEra$Salesperson_Purchaser] sp ON sh.[Salesperson Code] = sp.[Code]
        LEFT JOIN [NewEra$Geographical Zone] gz ON c.[Geographical Zone 2] = gz.[Geographical Zone]

    WHERE sl.[Type] IN (19, 20)
      AND sh.[Selling Season Code] = @StagioneDaAnalizzare

    GROUP BY
        sh.[Document Type], sh.[No_], sh.[Sell-to Customer No_], sh.[Salesperson Code], sp.[Name],
        sh.[Selling Season Code], sh.[Payment Method Code], sh.[Payment Terms Code],
        sl.[Delete Reason], sl.[Currency Code],
        c.[Name], c.[Name 2], c.[Address], c.[Post Code], c.[City], c.[County],
        c.[Country_Region Code], c.[VAT Registration No_], c.[Fiscal Code], c.[Purchase Group],
        c.[Payment Method Code], c.[Payment Terms Code], c.[Blocked for Assignments],
        c.[Credit Limit (LCY)], c.[Current Risk], c.[Credit Limit], c.[Risk Rating],
        c.[Updated Date], c.[Due Date],
        gz.[Credit Manager], gz.[Description], gz.[Geographical Zone]
)

SELECT
    *,
    -- Flag derivati (in Access erano campi calcolati basati su bit Anomalous/Checked)
    -- Da riabilitare quando confermata presenza campi custom
    -- CASE WHEN IsAnomalo = 1 THEN 'X' ELSE '' END AS Anomalo,
    -- CASE WHEN IsVerificato = 1 THEN 'X' ELSE '' END AS Verificato,
    -- CASE WHEN IsAnomalo = 1 AND IsVerificato <> 1 THEN 'X' ELSE '' END AS DaVerificare,

    -- Scadenza valutazione credito (DataValutazione + 365 giorni)
    DATEADD(day, 365, DataValutazione)  AS DataScadenzaValutazione

FROM OrdiniConCredito
ORDER BY GeographicalZone2, SalesPersonCode, [Sell-to Customer No_], OrderNo;
