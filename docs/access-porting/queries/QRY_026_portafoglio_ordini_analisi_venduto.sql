-- ============================================================
-- QRY_026 — Portafoglio Ordini / Analisi Venduto (output.xlsx)
-- Fonte originale:
--   def01-ANALISIVENDUTO-PIVOT
--   → def01-ANALISIVENDUTO-PIVOT-step0
--     → qSoloVend-step1
--       → qSoloVend (= qSoloVendNoFiltr-STEP0 + filtri)
--         → qSoloVendNoFiltr-STEP0
--           → qsoloVend-DatiBolleAperteRilasciate
--           → dateprenotazionipervendite
--   + DatiCarryOverESMU, MustBuy-ArticoloColore, LandedCost, CrossReferenceCliente
--
-- Scopo: Portafoglio ordini di vendita completo per stagione/marchio con
--        quantità vendute/spedite/fatturate/pronte, provvigioni, margine stimato,
--        dati anagrafici cliente e articolo, dati carry-over e SMU.
--
-- Parametri:
--   @SeasonCode       NVARCHAR(20)  — stagione (es. 'E26'). NULL = tutte
--   @TrademarkCode    NVARCHAR(20)  — marchio (es. 'CPH'). NULL = tutti
--   @SalespersonCode  NVARCHAR(20)  — agente (es. '1184'). NULL = tutti
--   @CustomerCode     NVARCHAR(20)  — cliente Sell-to (es. 'C06995'). NULL = tutti
--                                    (era [Forms]![Principale]![filtroclienteanalisi])
--
-- Note porting:
--   - [AZIENDA$...] è il placeholder per il company prefix NAV (es. [NewEra$...])
--   - Val() → CAST/TRY_CAST + ISNULL; IIf() → CASE WHEN; Nz() → ISNULL()
--   - DatiCarryOverESMU usa [Configurator Relation]=3 per filtrare SKU (non varianti modello)
--   - LandedCost = Standard Cost dell'item dove Configurator Relation=3 e Standard Cost>0
--   - CrossReferenceCliente = Cross-Reference Model Item di tipo 1 (cliente)
--   - dateprenotazionipervendite = Reserv__Assign_ Link di tipo 1 (prenotazione vendita)
--   - qsoloVend-DatiBolleAperteRilasciate: status DDT 0=aperta, 1=rilasciata, 41=da inviare WMS,
--     42=inviato WMS, 43=evaso WMS
--   - Sales Header Extension è una tabella custom NAV (custom fields extension)
--   - ⚠️ CHIARIMENTO RICHIESTO: verificare nome esatto tabella [AZIENDA$Sales Header Extension]
--     potrebbe chiamarsi diversamente in FEBOS_10
--   - ⚠️ CHIARIMENTO RICHIESTO: verificare se [AZIENDA$Cross-Reference Model Item] esiste
--     o se si chiama [AZIENDA$Item Cross Reference]
-- ============================================================

DECLARE @SeasonCode      NVARCHAR(20) = NULL;  -- es. 'E26'
DECLARE @TrademarkCode   NVARCHAR(20) = NULL;  -- es. 'CPH'
DECLARE @SalespersonCode NVARCHAR(20) = NULL;  -- es. '1184'
DECLARE @CustomerCode    NVARCHAR(20) = NULL;  -- es. 'C06995' (Sell-to Customer No_)

WITH

-- ──────────────────────────────────────────────────────────────────────────────
-- CTE 1: Prenotazioni di vendita (= dateprenotazionipervendite)
-- Fonte: [Reserv__Assign_ Link] tipo 1 (prenotazione su ordine di vendita)
-- ──────────────────────────────────────────────────────────────────────────────
date_prenotazioni AS (
    SELECT
        ral.[Sales Document No_],
        ral.[Sales Line No_],
        MAX(ral.[Date Reservation]) AS [Date Reservation]
    FROM [AZIENDA$Reserv__Assign_ Link] ral
    WHERE ral.[Reserv__Assign_ Type] = 1
    GROUP BY ral.[Sales Document No_], ral.[Sales Line No_]
),

-- ──────────────────────────────────────────────────────────────────────────────
-- CTE 2: Status picking DDT (= qsoloVend-DatiBolleAperteRilasciate)
-- Quantità in bolla per ordine/riga, suddivise per status del DDT
-- Status: 0=aperto, 1=rilasciato, 41=da inviare WMS, 42=inviato WMS, 43=evaso WMS
-- ──────────────────────────────────────────────────────────────────────────────
picking_status AS (
    SELECT
        dpl.[Order No_],
        dpl.[Order Line No_],
        SUM(ISNULL(TRY_CAST(dpl.[No_ of Pairs] AS DECIMAL(18,4)), 0))                                  AS PaiaInBollaTotale,
        SUM(ISNULL(TRY_CAST(dpl.[Quantity]      AS DECIMAL(18,4)), 0))                                  AS QuantitaInBollaTotale,
        SUM(CASE WHEN dph.Status = 1  THEN ISNULL(TRY_CAST(dpl.[No_ of Pairs] AS DECIMAL(18,4)), 0) ELSE 0 END) AS PaiaInBollaRilasciate,
        SUM(CASE WHEN dph.Status = 1  THEN ISNULL(TRY_CAST(dpl.[Quantity]      AS DECIMAL(18,4)), 0) ELSE 0 END) AS QuantitaInBollaRilasciate,
        SUM(CASE WHEN dph.Status = 0  THEN ISNULL(TRY_CAST(dpl.[No_ of Pairs] AS DECIMAL(18,4)), 0) ELSE 0 END) AS PaiaInBollaAperte,
        SUM(CASE WHEN dph.Status = 0  THEN ISNULL(TRY_CAST(dpl.[Quantity]      AS DECIMAL(18,4)), 0) ELSE 0 END) AS QuantitaInBollaAperte,
        SUM(CASE WHEN dph.Status = 41 THEN ISNULL(TRY_CAST(dpl.[No_ of Pairs] AS DECIMAL(18,4)), 0) ELSE 0 END) AS PaiaInBollaDaInviareWMSps,
        SUM(CASE WHEN dph.Status = 41 THEN ISNULL(TRY_CAST(dpl.[Quantity]      AS DECIMAL(18,4)), 0) ELSE 0 END) AS QuantitaInBollaDaInviareWMSps,
        SUM(CASE WHEN dph.Status = 42 THEN ISNULL(TRY_CAST(dpl.[No_ of Pairs] AS DECIMAL(18,4)), 0) ELSE 0 END) AS PaiaInBollaInviatoWMSps,
        SUM(CASE WHEN dph.Status = 42 THEN ISNULL(TRY_CAST(dpl.[Quantity]      AS DECIMAL(18,4)), 0) ELSE 0 END) AS QuantitaInBollaInviatoWMSps,
        SUM(CASE WHEN dph.Status = 43 THEN ISNULL(TRY_CAST(dpl.[No_ of Pairs] AS DECIMAL(18,4)), 0) ELSE 0 END) AS PaiaInBollaEvasoWMSps,
        SUM(CASE WHEN dph.Status = 43 THEN ISNULL(TRY_CAST(dpl.[Quantity]      AS DECIMAL(18,4)), 0) ELSE 0 END) AS QuantitaInBollaEvasoWMSps
    FROM [AZIENDA$DDT_Picking Line] dpl
    INNER JOIN [AZIENDA$DDT_Picking Header] dph
        ON dpl.[Document Type] = dph.[Document Type]
        AND dpl.[Document No_] = dph.No_
    WHERE dpl.Type IN (19, 20)
        AND dph.[Document Type] = 0
        AND dph.Status IN (0, 1, 41, 42, 43)
    GROUP BY dpl.[Order No_], dpl.[Order Line No_]
),

-- ──────────────────────────────────────────────────────────────────────────────
-- CTE 3: Landed cost per articolo (= LandedCost tramite LandedCost-step0)
-- Standard Cost degli SKU (Configurator Relation=3) con costo > 0, mediato per modello
-- ──────────────────────────────────────────────────────────────────────────────
landed_cost AS (
    SELECT
        i.[Model Item No_] AS No_,
        AVG(ISNULL(TRY_CAST(i.[Standard Cost] AS DECIMAL(18,4)), 0)) AS [landed Cost]
    FROM [AZIENDA$Item] i
    WHERE i.[Configurator Relation] = 3
        AND ISNULL(TRY_CAST(i.[Standard Cost] AS DECIMAL(18,4)), 0) > 0
    GROUP BY i.[Model Item No_]
),

-- ──────────────────────────────────────────────────────────────────────────────
-- CTE 4: Dati Carry Over / SMU / Sold Out per SKU (= DatiCarryOverESMU)
-- Solo SKU (Configurator Relation=3)
-- ──────────────────────────────────────────────────────────────────────────────
carry_over AS (
    SELECT
        i.[Model Item No_],
        i.[Variable Code 01],
        i.Smu,
        i.[Carry Over],
        i.[Future Carry Over],
        i.[Sold Out],
        i.[Sold Out Date],
        i.[Sales_Purchase Status - Item],
        i.[Sales_Purchase Status Date],
        i.[Potential Sold Out],
        ISNULL(TRY_CAST(i.[Minimum Order Quantity] AS DECIMAL(18,4)), 0) AS MOQ
    FROM [AZIENDA$Item] i
    WHERE i.[Configurator Relation] = 3
),

-- ──────────────────────────────────────────────────────────────────────────────
-- CTE 5: Must Buy per articolo/colore (= MustBuy-ArticoloColore)
-- ──────────────────────────────────────────────────────────────────────────────
must_buy AS (
    SELECT
        i.[Must Buy],
        i.[Variable Code 01],
        i.[Model Item No_]
    FROM [AZIENDA$Item] i
    WHERE i.[Configurator Relation] = 3
    GROUP BY i.[Must Buy], i.[Variable Code 01], i.[Model Item No_]
),

-- ──────────────────────────────────────────────────────────────────────────────
-- CTE 6: Cross-reference cliente per articolo/colore (= CrossReferenceCliente)
-- Tipo 1 = cross-reference di tipo "Cliente" (barcode/codice cliente)
-- ──────────────────────────────────────────────────────────────────────────────
cross_ref_cliente AS (
    SELECT
        cr.[Model Item No_],
        cr.[Cross-Reference Type No_],
        cr.[Constant Variable Code],
        cr.[Cross-Reference No_]
    FROM [AZIENDA$Cross-Reference Model Item] cr
    WHERE cr.[Cross-Reference Type] = 1
),

-- ──────────────────────────────────────────────────────────────────────────────
-- CTE 7: Righe ordine base con calcolo quantità/valori (= qSoloVendNoFiltr-STEP0)
-- Include: SALES (doc type 1) e RETURNS (doc type 5)
-- Calcola per riga: sold/shipped/invoiced/returned/credited quantities, pairs, values
-- Aggiunge: provvigioni, dati picking, prenotazioni
-- ──────────────────────────────────────────────────────────────────────────────
base_lines AS (
    SELECT
        -- Document type label
        CASE sl.[Document Type] WHEN 1 THEN 'SALES' WHEN 5 THEN 'RETURNS' ELSE '' END AS DocumentType,

        -- Line identifiers
        sl.Type,
        sl.No_,
        sl.[Customer Order Ref_],
        sl.Reference,
        sl.[Gen_ Bus_ Posting Group],
        sl.[VAT Bus_ Posting Group],
        she.[Warehouse Speciality Code]             AS CodSpecialitaOrdine,
        sh.[Customer Posting Group],
        sl.[Unit of Measure],
        sl.[Constant Variable Code],
        sl.[Assortment Code],
        sl.[Delete Reason],
        sl.[Sales_Purchase Status Code],
        sl.[Sales_Purchase Status - Item],
        sl.[Delete Date],
        sl.[Customer Price Group],
        sl.[Average Unit Price],

        -- Order header data
        sh.[Order Date],
        sh.[Subject 1],
        sp2.Name                                    AS Subject1Name,
        sh.[Subject 2],
        sp3.Name                                    AS Subject2Name,
        she.[Subject 3],
        sp4.Name                                    AS Subject3Name,
        she.[Subject 4],
        sp5.Name                                    AS Subject4Name,
        sp1.Code                                    AS CapozonaCodice,
        sp1.Name                                    AS Capozona,
        sh.[Salesperson Code],
        sp.Name                                     AS Salesperson,
        sl.[Constant Variable Code]                 AS ColorCode,
        sh.[Bill-to Customer No_],
        sh.[Bill-to Name],
        sh.[Sell-to Customer No_],
        sh.[Securities Received],
        sl.[Document No_],
        sl.[Line No_],

        -- Order type (Italian labels matching original)
        CASE sh.[Order Type]
            WHEN 0  THEN 'Progr'
            WHEN 1  THEN 'Riass.'
            WHEN 2  THEN 'Pronto'
            WHEN 3  THEN 'Stock'
            WHEN 4  THEN 'Sost.'
            WHEN 5  THEN 'PreSeason'
            WHEN 17 THEN 'Commerciale'
            WHEN 18 THEN 'Selection'
            ELSE '?'
        END                                         AS OrderType,

        -- Order period (MM/1|2|3 based on day of month)
        RIGHT('0' + CAST(MONTH(sh.[Order Date]) AS NVARCHAR(2)), 2) + '/' +
            CASE
                WHEN DAY(sh.[Order Date]) < 11 THEN '1'
                WHEN DAY(sh.[Order Date]) < 21 THEN '2'
                ELSE '3'
            END                                     AS OrderPeriod,

        -- ── Sold ──────────────────────────────────────────────────────────────
        CASE sl.[Document Type]
            WHEN 1 THEN  ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
            ELSE         -ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
        END                                         AS PairsSold,
        CASE sl.[Document Type]
            WHEN 1 THEN  ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0)
            ELSE         -ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0)
        END                                         AS QuantitySold,
        sh.[Currency Code],
        CASE sl.[Document Type]
            WHEN 1 THEN  ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0) - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0)
            ELSE        -(ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0) - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0))
        END                                         AS ValueSold,

        -- ── Shipped ───────────────────────────────────────────────────────────
        ISNULL(TRY_CAST(sl.[Quantity Shipped] AS DECIMAL(18,4)), 0) AS QuantityShipped,
        CASE WHEN ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0) > 0
            THEN ISNULL(TRY_CAST(sl.[Quantity Shipped] AS DECIMAL(18,4)), 0)
                 / ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 1)
                 * ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
            ELSE 0
        END                                         AS PairsShipped,
        CASE WHEN ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0) > 0
            THEN ISNULL(TRY_CAST(sl.[Quantity Shipped] AS DECIMAL(18,4)), 0)
                 / ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 1)
                 * (CASE sl.[Document Type]
                        WHEN 1 THEN  ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0) - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0)
                        ELSE        -(ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0) - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0))
                    END)
            ELSE 0
        END                                         AS ValueShipped,

        -- ── Invoiced ──────────────────────────────────────────────────────────
        CASE sl.[Document Type]
            WHEN 1 THEN ISNULL(TRY_CAST(sl.[Quantity Invoiced] AS DECIMAL(18,4)), 0)
            ELSE 0
        END                                         AS QuantityInvoiced,
        CASE sl.[Document Type]
            WHEN 1 THEN
                CASE WHEN ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0) > 0
                    THEN ISNULL(TRY_CAST(sl.[Quantity Invoiced] AS DECIMAL(18,4)), 0)
                         / ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 1)
                         * ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
                    ELSE 0 END
            ELSE 0
        END                                         AS PairsInvoiced,
        CASE sl.[Document Type]
            WHEN 1 THEN
                CASE WHEN ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0) > 0
                    THEN ISNULL(TRY_CAST(sl.[Quantity Invoiced] AS DECIMAL(18,4)), 0)
                         / ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 1)
                         * (ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0) - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0))
                    ELSE 0 END
            ELSE 0
        END                                         AS ValueInvoiced,

        -- ── Returned ──────────────────────────────────────────────────────────
        -ISNULL(TRY_CAST(sl.[Return Qty_ Received] AS DECIMAL(18,4)), 0) AS QuantityReturned,
        CASE WHEN ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0) > 0
            THEN -ISNULL(TRY_CAST(sl.[Return Qty_ Received] AS DECIMAL(18,4)), 0)
                 / ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 1)
                 * ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
            ELSE 0
        END                                         AS PairsReturned,
        CASE WHEN ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0) > 0
            THEN ISNULL(TRY_CAST(sl.[Return Qty_ Received] AS DECIMAL(18,4)), 0)
                 / ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 1)
                 * (CASE sl.[Document Type]
                        WHEN 1 THEN  ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0) - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0)
                        ELSE        -(ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0) - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0))
                    END)
            ELSE 0
        END                                         AS ValueReturned,

        -- ── Credited ──────────────────────────────────────────────────────────
        CASE sl.[Document Type]
            WHEN 5 THEN -ISNULL(TRY_CAST(sl.[Quantity Invoiced] AS DECIMAL(18,4)), 0)
            ELSE 0
        END                                         AS QuantityCredited,
        CASE sl.[Document Type]
            WHEN 5 THEN
                CASE WHEN ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0) > 0
                    THEN -ISNULL(TRY_CAST(sl.[Quantity Invoiced] AS DECIMAL(18,4)), 0)
                         / ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 1)
                         * ISNULL(TRY_CAST(sl.[No_ of Pairs] AS DECIMAL(18,4)), 0)
                    ELSE 0 END
            ELSE 0
        END                                         AS PairsCredited,
        CASE sl.[Document Type]
            WHEN 5 THEN
                CASE WHEN ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0) > 0
                    THEN ISNULL(TRY_CAST(sl.[Quantity Invoiced] AS DECIMAL(18,4)), 0)
                         / ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 1)
                         * ABS(ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0) - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0))
                    ELSE 0 END
            ELSE 0
        END                                         AS ValueCredited,

        -- ── Commissions ───────────────────────────────────────────────────────
        ISNULL(TRY_CAST(sl.[Subject 1 Commission _]   AS DECIMAL(18,4)), 0) AS ProvvigioneSoggetto1,
        ISNULL(TRY_CAST(sl.[Subject 2 Commission _]   AS DECIMAL(18,4)), 0) AS ProvvigioneSoggetto2,
        ISNULL(TRY_CAST(sl.[Subject 3 Commission _]   AS DECIMAL(18,4)), 0) AS ProvvigioneSoggetto3,
        ISNULL(TRY_CAST(sl.[Subject 4 Commission _]   AS DECIMAL(18,4)), 0) AS ProvvigioneSoggetto4,
        ISNULL(TRY_CAST(sl.[Area Manager Commission _] AS DECIMAL(18,4)), 0) AS ProvvigioneCapozona,
        ISNULL(TRY_CAST(sl.[Salesperson Commission _]  AS DECIMAL(18,4)), 0) AS ProvvigioneAgente,

        -- ── Return reason / Ship-to ────────────────────────────────────────────
        sl.[Return Reason Code]                     AS ReturnReasonCode,
        sh.[Ship-to Code],
        sh.[Ship-to Name]                           AS ClienteSpedizione,
        sh.[Ship-to Name 2]                         AS ClienteSpedizione2,
        sh.[Ship-to Address]                        AS IndirizzoSpedizione,
        sh.[Ship-to Address 2]                      AS IndirizzoSpedizione2,
        sh.[Ship-to City]                           AS CittaSpedizione,
        sh.[Ship-to Post Code]                      AS CodicePostaleSpedizione,
        sh.[Ship-to County]                         AS CountySpedizione,
        sl.[Requested Delivery Date],

        -- ── Ready For Shipping (from DDT picking) ─────────────────────────────
        ISNULL(ps.PaiaInBollaTotale,          0)    AS PairsReadyForShippingTotale,
        ISNULL(ps.QuantitaInBollaTotale,      0)    AS QuantityReadyForShippingTotale,
        CASE WHEN ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0) > 0
            THEN ISNULL(ps.QuantitaInBollaTotale, 0)
                 / ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 1)
                 * (CASE sl.[Document Type]
                        WHEN 1 THEN  ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0) - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0)
                        ELSE        -(ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0) - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0))
                    END)
            ELSE 0
        END                                         AS ValueReadyForShippingTotale,
        ISNULL(ps.PaiaInBollaRilasciate,      0)    AS PairsReadyForShippingRilasciate,
        ISNULL(ps.QuantitaInBollaRilasciate,  0)    AS QuantityReadyForShippingRilasciate,
        CASE WHEN ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0) > 0
            THEN ISNULL(ps.QuantitaInBollaRilasciate, 0)
                 / ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 1)
                 * (CASE sl.[Document Type]
                        WHEN 1 THEN  ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0) - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0)
                        ELSE        -(ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0) - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0))
                    END)
            ELSE 0
        END                                         AS ValueReadyForShippingRilasciate,
        ISNULL(ps.PaiaInBollaAperte,          0)    AS PairsReadyForShippingAperte,
        ISNULL(ps.QuantitaInBollaAperte,      0)    AS QuantityReadyForShippingAperte,
        CASE WHEN ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 0) > 0
            THEN ISNULL(ps.QuantitaInBollaAperte, 0)
                 / ISNULL(TRY_CAST(sl.[Quantity] AS DECIMAL(18,4)), 1)
                 * (CASE sl.[Document Type]
                        WHEN 1 THEN  ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0) - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0)
                        ELSE        -(ISNULL(TRY_CAST(sl.[Line Amount] AS DECIMAL(18,4)), 0) - ISNULL(TRY_CAST(sl.[Inv_ Discount Amount] AS DECIMAL(18,4)), 0))
                    END)
            ELSE 0
        END                                         AS ValueReadyForShippingAperte,
        ISNULL(ps.PaiaInBollaDaInviareWMSps,  0)    AS PairsReadyForShippingDaInviareWMSps,
        ISNULL(ps.QuantitaInBollaDaInviareWMSps, 0) AS QuantityReadyForShippingDaInviareWMSps,
        ISNULL(ps.PaiaInBollaInviatoWMSps,    0)    AS PairsReadyForShippingInviatoWMSps,
        ISNULL(ps.QuantitaInBollaInviatoWMSps, 0)   AS QuantityReadyForShippingInviatoWMSps,
        ISNULL(ps.PaiaInBollaEvasoWMSps,      0)    AS PairsReadyForShippingEvasoWMSps,
        ISNULL(ps.QuantitaInBollaEvasoWMSps,  0)    AS QuantityReadyForShippingEvasoWMSps,

        -- ── Payment / Shipping method ──────────────────────────────────────────
        sh.[Payment Terms Code],
        sh.[Payment Method Code],
        sh.[Invoice Discount Calculation]           AS CalcoloScontoFattura,
        ISNULL(TRY_CAST(sh.[Invoice Discount Value] AS DECIMAL(18,4)), 0) AS ScontoFattura,
        CASE WHEN sh.[Consignment] = 1 THEN 'SI' ELSE 'NO' END AS ContoVendita,
        ISNULL(TRY_CAST(sh.[Right on Return _] AS DECIMAL(18,4)), 0) AS PercentualeDirittoAlReso,
        sh.Note,
        sh.[Campaign No_],
        sh.[event code],
        ISNULL(TRY_CAST(sl.[Line Discount _]  AS DECIMAL(18,4)), 0) AS ScontoRiga,
        ISNULL(TRY_CAST(sl.[Discount 1 _]     AS DECIMAL(18,4)), 0) AS Sconto1Riga,
        ISNULL(TRY_CAST(sl.[Discount 2 _]     AS DECIMAL(18,4)), 0) AS Sconto2Riga,
        ISNULL(TRY_CAST(sl.[Discount 3 _]     AS DECIMAL(18,4)), 0) AS Sconto3Riga,

        -- ── Anomaly / Credit check ─────────────────────────────────────────────
        CASE WHEN sh.[Anomalous]     = 1 THEN 'X' ELSE '' END AS Anomalo,
        CASE WHEN sh.[Not Anomalous] = 1 THEN 'X' ELSE '' END AS NonAnomalo,
        sh.[Anomalous Date],
        CASE WHEN sh.[Checked] = 1 THEN 'X' ELSE '' END AS Verificato,
        sh.[Checked Date],
        sh.[Budget No_],
        sh.[Course Date]                            AS DataDecorrenza,
        sh.[KIMO_FASHION SO No_]                    AS KimoOrder,

        -- ── Shipping ──────────────────────────────────────────────────────────
        sh.[Shipment Method Code]                   AS ShipmentMethodCode,
        smeth.Description                           AS ShipmentMethodDescription,
        sh.[Transport Reason Code],
        trc.Description                             AS TransportReasonCodeDescription,
        sl.[Location Code],
        sh.[Shipping Agent Code],
        sh.[Shipping Agent Service Code],
        dp.[Date Reservation],
        sh.[Fast Shipping],

        -- ── Commission group / Geo / Budget ──────────────────────────────────
        sh.[Commission Group Code]                  AS CommissionGroupCodeOrder,
        sh.[Geographical Zone]                      AS GeographicalZoneFromOrder,
        gz_order.Description                        AS GeographicalZoneDescriptionFromOrder,
        bh.[Budget Area],
        sl.[Model Cross Reference],
        sh.[Shortcut Dimension 2 Code]              AS [trademark code],
        sh.[Selling Season Code]                    AS [Season Code]

    FROM [AZIENDA$Sales Line] sl
    INNER JOIN [AZIENDA$Sales Header] sh
        ON sl.[Document Type] = sh.[Document Type]
        AND sl.[Document No_] = sh.No_
    LEFT JOIN [AZIENDA$Salesperson_Purchaser] sp
        ON sh.[Salesperson Code] = sp.Code
    INNER JOIN [AZIENDA$Variable Code] vc
        ON sl.[Constant Assortment Var_Grp_] = vc.[Variable Group]
        AND sl.[Constant Variable Code] = vc.[Variable Code]
    LEFT JOIN picking_status ps
        ON sl.[Document No_] = ps.[Order No_]
        AND sl.[Line No_] = ps.[Order Line No_]
    LEFT JOIN [AZIENDA$Shipment Method] smeth
        ON sh.[Shipment Method Code] = smeth.Code
    LEFT JOIN [AZIENDA$Salesperson_Purchaser] sp1   -- Area Manager / Capozona
        ON sh.[Area Manager Code] = sp1.Code
    LEFT JOIN [AZIENDA$Salesperson_Purchaser] sp2   -- Subject 1
        ON sh.[Subject 1] = sp2.Code
    LEFT JOIN [AZIENDA$Salesperson_Purchaser] sp3   -- Subject 2
        ON sh.[Subject 2] = sp3.Code
    LEFT JOIN [AZIENDA$Transport Reason Code] trc
        ON sh.[Transport Reason Code] = trc.Code
    LEFT JOIN date_prenotazioni dp
        ON sl.[Document No_] = dp.[Sales Document No_]
        AND sl.[Line No_] = dp.[Sales Line No_]
    LEFT JOIN [AZIENDA$Geographical Zone] gz_order
        ON sh.[Geographical Zone] = gz_order.Code
    LEFT JOIN [AZIENDA$Budget Header] bh
        ON sh.[Budget No_] = bh.No_
    LEFT JOIN [AZIENDA$Sales Header Extension] she
        ON sh.No_ = she.[Document No_]
        AND sh.[Document Type] = she.[Document Type]
    LEFT JOIN [AZIENDA$Salesperson_Purchaser] sp4   -- Subject 3 (from Extension)
        ON she.[Subject 3] = sp4.Code
    LEFT JOIN [AZIENDA$Salesperson_Purchaser] sp5   -- Subject 4 (from Extension)
        ON she.[Subject 4] = sp5.Code

    -- Include only lines with meaningful document type (SALES or RETURNS)
    WHERE CASE sl.[Document Type] WHEN 1 THEN 'SALES' WHEN 5 THEN 'RETURNS' ELSE '' END <> ''
        AND sl.Type IN (19, 20)  -- 19=assortment, 20=item
        -- Dynamic filters (from form parameters)
        AND (@SeasonCode      IS NULL OR sh.[Selling Season Code]        = @SeasonCode)
        AND (@TrademarkCode   IS NULL OR sh.[Shortcut Dimension 2 Code]  = @TrademarkCode)
        AND (@SalespersonCode IS NULL OR sh.[Salesperson Code]           = @SalespersonCode)
        AND (@CustomerCode    IS NULL OR sh.[Sell-to Customer No_]      = @CustomerCode)
),

-- ──────────────────────────────────────────────────────────────────────────────
-- CTE 8: Aggregazione righe + arricchimento cliente/ship-to (= qSoloVend-step1)
-- GROUP BY per consolidare eventuali righe duplicate da LEFT JOIN multipli
-- ──────────────────────────────────────────────────────────────────────────────
agg_lines AS (
    SELECT
        bl.[Document No_],
        bl.[Line No_],
        bl.[Customer Order Ref_],
        bl.Reference,
        bl.[Gen_ Bus_ Posting Group],
        bl.[VAT Bus_ Posting Group],
        bl.[Customer Posting Group],
        bl.No_                                      AS Article,
        bl.[Constant Variable Code],
        bl.[Salesperson Code],
        bl.Salesperson,
        bl.CapozonaCodice,
        bl.Capozona,
        bl.[Subject 1],
        bl.Subject1Name,
        bl.[Subject 2],
        bl.Subject2Name,
        bl.[Subject 3],
        bl.Subject3Name,
        bl.[Subject 4],
        bl.Subject4Name,
        bl.[Sales_Purchase Status Code],
        bl.[Sales_Purchase Status - Item],
        bl.[Delete Reason],
        bl.[Delete Date],
        bl.[Assortment Code],
        bl.[Order Date],
        bl.[Bill-to Customer No_],
        bl.[Bill-to Name],
        bl.CodSpecialitaOrdine,
        bl.ColorCode,
        bl.[Sell-to Customer No_]                   AS CustomerCode,
        c.[Geographical Zone],
        c.Name                                      AS CustomerName,
        c.[Blocked for Assignments],
        bl.OrderPeriod,
        bl.[Currency Code],
        SUM(bl.QuantitySold)                        AS QuantitySold,
        SUM(bl.PairsSold)                           AS PairsSold,
        SUM(bl.ValueSold)                           AS ValueSold,
        SUM(bl.QuantityShipped)                     AS QuantityShipped,
        SUM(bl.PairsShipped)                        AS PairsShipped,
        SUM(bl.ValueShipped)                        AS ValueShipped,
        SUM(bl.QuantityInvoiced)                    AS QuantityInvoiced,
        SUM(bl.PairsInvoiced)                       AS PairsInvoiced,
        SUM(bl.ValueInvoiced)                       AS ValueInvoiced,
        SUM(bl.QuantityReadyForShippingTotale)      AS QuantityReadyForShippingTotale,
        SUM(bl.PairsReadyForShippingTotale)         AS PairsReadyForShippingTotale,
        SUM(bl.ValueReadyForShippingTotale)         AS ValueReadyForShippingTotale,
        SUM(bl.QuantityReadyForShippingRilasciate)  AS QuantityReadyForShippingRilasciate,
        SUM(bl.PairsReadyForShippingRilasciate)     AS PairsReadyForShippingRilasciate,
        SUM(bl.ValueReadyForShippingRilasciate)     AS ValueReadyForShippingRilasciate,
        SUM(bl.QuantityReadyForShippingAperte)      AS QuantityReadyForShippingAperte,
        SUM(bl.PairsReadyForShippingAperte)         AS PairsReadyForShippingAperte,
        SUM(bl.ValueReadyForShippingAperte)         AS ValueReadyForShippingAperte,
        SUM(bl.QuantityReadyForShippingDaInviareWMSps) AS QuantityReadyForShippingDaInviareWMSps,
        SUM(bl.PairsReadyForShippingDaInviareWMSps)    AS PairsReadyForShippingDaInviareWMSps,
        SUM(bl.QuantityReadyForShippingInviatoWMSps)   AS QuantityReadyForShippingInviatoWMSps,
        SUM(bl.PairsReadyForShippingInviatoWMSps)      AS PairsReadyForShippingInviatoWMSps,
        SUM(bl.QuantityReadyForShippingEvasoWMSps)     AS QuantityReadyForShippingEvasoWMSps,
        SUM(bl.PairsReadyForShippingEvasoWMSps)        AS PairsReadyForShippingEvasoWMSps,
        SUM(bl.QuantityReturned)                    AS QuantityReturned,
        SUM(bl.PairsReturned)                       AS PairsReturned,
        SUM(bl.ValueReturned)                       AS ValueReturned,
        SUM(bl.QuantityCredited)                    AS QuantityCredited,
        SUM(bl.PairsCredited)                       AS PairsCredited,
        SUM(bl.ValueCredited)                       AS ValueCredited,
        bl.ProvvigioneAgente,
        bl.ProvvigioneCapozona,
        bl.ProvvigioneSoggetto1,
        bl.ProvvigioneSoggetto2,
        bl.ProvvigioneSoggetto3,
        bl.ProvvigioneSoggetto4,
        c.[Geographical Zone 2],
        bl.OrderType,
        bl.ReturnReasonCode,
        bl.DocumentType,
        bl.[Ship-to Code],
        bl.ClienteSpedizione,
        bl.ClienteSpedizione2,
        bl.IndirizzoSpedizione,
        bl.IndirizzoSpedizione2,
        bl.CittaSpedizione,
        bl.CodicePostaleSpedizione,
        bl.CountySpedizione,
        bl.[Requested Delivery Date],
        bl.[Payment Terms Code],
        bl.[Payment Method Code],
        bl.ShipmentMethodCode,
        bl.ShipmentMethodDescription,
        bl.CalcoloScontoFattura,
        bl.[Customer Price Group],
        bl.ScontoFattura,
        bl.ScontoRiga,
        bl.Sconto1Riga,
        bl.Sconto2Riga,
        bl.Sconto3Riga,
        c.[E-Mail],
        bl.ContoVendita,
        bl.PercentualeDirittoAlReso,
        bl.Note,
        bl.[Campaign No_],
        bl.[event code],
        bl.[Securities Received],
        bl.Anomalo,
        bl.NonAnomalo,
        bl.[Anomalous Date],
        bl.Verificato,
        bl.[Checked Date],
        bl.[Budget No_],
        bl.DataDecorrenza,
        bl.KimoOrder,
        she.[Old Order No_],
        bl.[Season Code],
        bl.[Transport Reason Code],
        bl.TransportReasonCodeDescription,
        bl.[Location Code],
        bl.[Shipping Agent Code],
        bl.[Shipping Agent Service Code],
        bl.[Date Reservation],
        bl.[Fast Shipping],
        sta.[Geographical Zone 2]                   AS ShipToGeographicalZone2,
        sta.[Country_Region Code]                   AS ShipTpCountryRegionCode,
        bl.CommissionGroupCodeOrder,
        she.[Special Requests],
        c.[Purchase Group],
        c.[Distribution Channel],
        bl.GeographicalZoneFromOrder,
        bl.GeographicalZoneDescriptionFromOrder,
        bl.[Budget Area],
        bl.[Model Cross Reference],
        bl.[trademark code]

    FROM base_lines bl
    LEFT JOIN [AZIENDA$Customer] c
        ON bl.[Sell-to Customer No_] = c.No_
    LEFT JOIN [AZIENDA$Sales Header Extension] she
        ON bl.[Document No_] = she.[Document No_]
    LEFT JOIN [AZIENDA$Ship-to Address] sta
        ON bl.[Sell-to Customer No_] = sta.[Customer No_]
        AND bl.[Ship-to Code] = sta.Code

    GROUP BY
        bl.[Document No_], bl.[Line No_], bl.[Customer Order Ref_], bl.Reference,
        bl.[Gen_ Bus_ Posting Group], bl.[VAT Bus_ Posting Group], bl.[Customer Posting Group],
        bl.No_, bl.[Constant Variable Code], bl.[Salesperson Code], bl.Salesperson,
        bl.CapozonaCodice, bl.Capozona,
        bl.[Subject 1], bl.Subject1Name, bl.[Subject 2], bl.Subject2Name,
        bl.[Subject 3], bl.Subject3Name, bl.[Subject 4], bl.Subject4Name,
        bl.[Sales_Purchase Status Code], bl.[Sales_Purchase Status - Item],
        bl.[Delete Reason], bl.[Delete Date], bl.[Assortment Code], bl.[Order Date],
        bl.[Bill-to Customer No_], bl.[Bill-to Name], bl.CodSpecialitaOrdine,
        bl.ColorCode, bl.[Sell-to Customer No_],
        c.[Geographical Zone], c.Name, c.[Blocked for Assignments],
        bl.OrderPeriod, bl.[Currency Code],
        bl.ProvvigioneAgente, bl.ProvvigioneCapozona,
        bl.ProvvigioneSoggetto1, bl.ProvvigioneSoggetto2, bl.ProvvigioneSoggetto3, bl.ProvvigioneSoggetto4,
        c.[Geographical Zone 2], bl.OrderType, bl.ReturnReasonCode, bl.DocumentType,
        bl.[Ship-to Code], bl.ClienteSpedizione, bl.ClienteSpedizione2,
        bl.IndirizzoSpedizione, bl.IndirizzoSpedizione2, bl.CittaSpedizione,
        bl.CodicePostaleSpedizione, bl.CountySpedizione, bl.[Requested Delivery Date],
        bl.[Payment Terms Code], bl.[Payment Method Code], bl.ShipmentMethodCode,
        bl.ShipmentMethodDescription, bl.CalcoloScontoFattura, bl.[Customer Price Group],
        bl.ScontoFattura, bl.ScontoRiga, bl.Sconto1Riga, bl.Sconto2Riga, bl.Sconto3Riga,
        c.[E-Mail], bl.ContoVendita, bl.PercentualeDirittoAlReso, bl.Note,
        bl.[Campaign No_], bl.[event code], bl.[Securities Received],
        bl.Anomalo, bl.NonAnomalo, bl.[Anomalous Date], bl.Verificato, bl.[Checked Date],
        bl.[Budget No_], bl.DataDecorrenza, bl.KimoOrder, she.[Old Order No_],
        bl.[Season Code], bl.[Transport Reason Code], bl.TransportReasonCodeDescription,
        bl.[Location Code], bl.[Shipping Agent Code], bl.[Shipping Agent Service Code],
        bl.[Date Reservation], bl.[Fast Shipping],
        sta.[Geographical Zone 2], sta.[Country_Region Code],
        bl.CommissionGroupCodeOrder, she.[Special Requests],
        c.[Purchase Group], c.[Distribution Channel],
        bl.GeographicalZoneFromOrder, bl.GeographicalZoneDescriptionFromOrder,
        bl.[Budget Area], bl.[Model Cross Reference], bl.[trademark code]
)

-- ──────────────────────────────────────────────────────────────────────────────
-- FINAL SELECT
-- Combines agg_lines with item master, customer extended data, carry-over,
-- landed cost, cross-references, geographical zone descriptions
-- Replicates CustomerCheckCode / SalesPersonCheckCode as first columns
-- (= def01-ANALISIVENDUTO-PIVOT-step0 + def01-ANALISIVENDUTO-PIVOT)
-- ──────────────────────────────────────────────────────────────────────────────
SELECT
    -- Check codes (duplicated first columns, used for pivot/filtering in Excel)
    al.CustomerCode                                 AS CustomerCheckCode,
    al.CustomerName                                 AS CustomerCheckName,
    al.[Salesperson Code]                           AS SalesPersonCheckCode,
    al.Salesperson                                  AS SalesPersonCheckName,

    -- All line data from aggregation
    al.[Document No_],
    al.[Line No_],
    al.[Customer Order Ref_],
    al.Reference,
    al.[Gen_ Bus_ Posting Group],
    al.[VAT Bus_ Posting Group],
    al.[Customer Posting Group],
    al.Article,
    al.[Constant Variable Code],
    al.[Model Cross Reference]                      AS CrossReferenceOrdine,
    crc.[Cross-Reference No_]                       AS CrossReferenceAnagrafica,
    al.[Salesperson Code],
    al.Salesperson,
    al.CapozonaCodice,
    al.Capozona,
    al.[Subject 1],
    al.Subject1Name,
    al.[Subject 2],
    al.Subject2Name,
    al.[Subject 3],
    al.Subject3Name,
    al.[Subject 4],
    al.Subject4Name,
    al.[Sales_Purchase Status Code],
    al.[Sales_Purchase Status - Item],
    al.[Delete Reason],
    al.[Delete Date],
    al.[Assortment Code],
    al.[Order Date],
    c.[Key Account],
    al.[Bill-to Customer No_],
    al.[Bill-to Name],
    c.[Warehouse Speciality Code]                   AS CodSpecialitaCliente,
    al.CodSpecialitaOrdine,
    c.[Language Code],
    c.[Fast Shipment]                               AS [Customer_Fast Shipment],
    al.ColorCode,
    al.CustomerCode,
    al.[Geographical Zone]                          AS GeographicalZone,
    al.CustomerName,
    al.[Blocked for Assignments],
    c.[Reason Block Code],
    al.OrderPeriod,
    al.[Currency Code],
    al.QuantitySold,
    al.PairsSold,
    al.ValueSold,
    al.QuantityShipped,
    al.PairsShipped,
    al.ValueShipped,
    al.QuantityInvoiced,
    al.PairsInvoiced,
    al.ValueInvoiced,
    al.QuantityReadyForShippingTotale,
    al.PairsReadyForShippingTotale,
    al.ValueReadyForShippingTotale,
    al.QuantityReadyForShippingRilasciate,
    al.PairsReadyForShippingRilasciate,
    al.ValueReadyForShippingRilasciate,
    al.QuantityReadyForShippingAperte,
    al.PairsReadyForShippingAperte,
    al.ValueReadyForShippingAperte,
    al.QuantityReadyForShippingDaInviareWMSps,
    al.PairsReadyForShippingDaInviareWMSps,
    -- ValueReadyForShippingDaInviareWMSps: not in step0, derivable if needed
    al.QuantityReadyForShippingInviatoWMSps,
    al.PairsReadyForShippingInviatoWMSps,
    -- ValueReadyForShippingInviatoWMSps: not in step0
    al.QuantityReadyForShippingEvasoWMSps,
    al.PairsReadyForShippingEvasoWMSps,
    -- ValueReadyForShippingEvasoWMSps: not in step0
    al.QuantityShipped + al.QuantityReadyForShippingRilasciate AS QuantityShippedReleased,
    al.PairsShipped    + al.PairsReadyForShippingRilasciate    AS PairsShippedReleased,
    al.ValueShipped    + al.ValueReadyForShippingRilasciate    AS ValueShippedReleased,
    al.QuantityReturned,
    al.PairsReturned,
    al.ValueReturned,
    al.QuantityCredited,
    al.PairsCredited,
    al.ValueCredited,
    al.ProvvigioneAgente,
    al.ProvvigioneCapozona,
    al.ProvvigioneSoggetto1,
    al.ProvvigioneSoggetto2,
    al.ProvvigioneSoggetto3,
    al.ProvvigioneSoggetto4,
    al.[Geographical Zone 2]                        AS GeographicalZone2,
    al.OrderType,
    al.ReturnReasonCode,
    al.DocumentType,
    al.[Ship-to Code],
    al.ClienteSpedizione,
    al.ClienteSpedizione2,
    al.IndirizzoSpedizione,
    al.IndirizzoSpedizione2,
    al.CittaSpedizione,
    al.CodicePostaleSpedizione,
    al.CountySpedizione,
    al.[Requested Delivery Date],
    al.[Payment Terms Code],
    al.[Payment Method Code],
    al.ShipmentMethodCode,
    al.ShipmentMethodDescription,
    al.CalcoloScontoFattura,
    al.[Customer Price Group],
    al.ScontoFattura,
    al.ScontoRiga,
    al.Sconto1Riga,
    al.Sconto2Riga,
    al.Sconto3Riga,
    al.[E-Mail],
    al.ContoVendita,
    al.PercentualeDirittoAlReso,
    al.Note,
    al.[Campaign No_],
    al.[event code],
    al.[Securities Received],
    al.Anomalo,
    al.NonAnomalo,
    al.[Anomalous Date],
    al.Verificato,
    al.[Checked Date],
    al.[Budget No_],
    al.DataDecorrenza,
    al.KimoOrder,
    al.[Old Order No_],

    -- ── Customer extended ──────────────────────────────────────────────────
    c.[VAT Registration No_],
    c.[Fiscal Code],

    -- ── Item master ────────────────────────────────────────────────────────
    i.Description,
    co.Smu,
    co.[Carry Over],
    i.[Description 2],
    al.[trademark code],
    al.[Season Code],
    i.[Collection Code],
    i.[Line Code],
    vc.Description                                  AS Color,
    gz1.Description                                 AS GeographicalZoneDescription,
    i.[Season Typology],
    i.[Product Family],
    i.[Product Sex],
    i.[Shipment Priority],
    i.[Innovation Degree],
    i.[Heel Height],
    i.[End Customer Price Gap],
    i.[Market Segment],
    i.[Product Typology],
    i.[Main Material],
    i.[Sole Material],
    mb.[Must Buy],
    gz2.Description                                 AS GeographicalZone2Description,

    -- ── Customer address ──────────────────────────────────────────────────
    c.[Name 2],
    c.Address,
    c.City,
    c.Contact,
    c.[Phone No_],
    c.[Country_Region Code],
    c.[Post Code],
    c.County,
    c.[Reservation Priority],
    c.[VAT Registration No_]                        AS PartitaIva,
    i.[Vendor No_],
    v.Name                                          AS Vendor,

    -- ── Lince credit risk ─────────────────────────────────────────────────
    c.[Current Risk]                                AS LinceRischioOggi,
    c.[Risk Rating],
    c.[PM Failure Assigned Score],
    c.[Updated Date]                                AS LinceAggiornamentoFile,
    c.[Updated Type]                                AS LinceTipoEvasione,
    c.[Due Date]                                    AS LinceDataEvasione,
    c.[Internal Valuation],
    c.[Valuation Date],
    c.[Business E-Mail],

    -- ── Margin estimates ──────────────────────────────────────────────────
    lc.[landed Cost],
    al.PairsSold * ISNULL(lc.[landed Cost], 0)      AS EstimatedLandedCostOnSold,
    al.ValueSold - al.PairsSold * ISNULL(lc.[landed Cost], 0) AS EstimatedMargin,
    al.ValueSold * al.ProvvigioneAgente   / 100.0   AS EstimatedCommissionSalesPerson,
    al.ValueSold * al.ProvvigioneCapozona / 100.0   AS EstimatedCommissionArewManager,
    al.ValueSold * al.ProvvigioneSoggetto1 / 100.0  AS EstimatedCommissionSubject1,
    al.ValueSold * al.ProvvigioneSoggetto2 / 100.0  AS EstimatedCommissionSubject2,
    al.ValueSold * al.ProvvigioneSoggetto3 / 100.0  AS EstimatedCommissionSubject3,
    al.ValueSold * al.ProvvigioneSoggetto4 / 100.0  AS EstimatedCommissionSubject4,
    (al.ValueSold - al.PairsSold * ISNULL(lc.[landed Cost], 0))
        - al.ValueSold * al.ProvvigioneAgente   / 100.0
        - al.ValueSold * al.ProvvigioneCapozona / 100.0
        - al.ValueSold * al.ProvvigioneSoggetto1 / 100.0
        - al.ValueSold * al.ProvvigioneSoggetto2 / 100.0
        - al.ValueSold * al.ProvvigioneSoggetto3 / 100.0
        - al.ValueSold * al.ProvvigioneSoggetto4 / 100.0 AS EstimatedSecondMargin,

    -- ── Item origin / status ──────────────────────────────────────────────
    i.[Country_Region of Origin Code],
    co.[Sold Out],
    co.[Sold Out Date],
    co.[Sales_Purchase Status Date],

    -- ── Customer contact ─────────────────────────────────────────────────
    c.[Fax No_],
    ISNULL(TRY_CAST(c.[Authorized Stores Number] AS INT), 0) AS PuntiVendita,
    CASE c.[Store Distribution]
        WHEN 3 THEN '3-Dept.Store'
        WHEN 2 THEN '2-Indipendent'
        WHEN 1 THEN '1-Chain'
        ELSE '0-UNK'
    END                                             AS StoreDistribution,
    CASE c.[Store Image]
        WHEN 4 THEN '4-Commodity'
        WHEN 3 THEN '3-Standard'
        WHEN 2 THEN '2-Premium'
        WHEN 1 THEN '1-Image'
        ELSE '0-UNK'
    END                                             AS StoreImage,
    CASE c.[Store Type]
        WHEN 3 THEN '3-Footwear'
        WHEN 2 THEN '2-Apparel-Footwear-Accessories'
        WHEN 1 THEN '1-Apparel-Footwear'
        ELSE '0-UNK'
    END                                             AS StoreType,
    c.[Various References],
    c.[Home Page],
    c.[Quality Control],
    c.[Old Febos No_],
    c.[Old Bridge No_],

    -- ── Shipping / logistics ──────────────────────────────────────────────
    al.[Transport Reason Code],
    al.TransportReasonCodeDescription,
    al.[Location Code],
    al.[Shipping Agent Code],
    al.[Shipping Agent Service Code],
    al.[Date Reservation],
    al.[Fast Shipping],
    al.ShipToGeographicalZone2,
    gz3.Description                                 AS ShipToGeographicalZone2Description,
    al.ShipTpCountryRegionCode,

    -- ── Payment / commission codes ────────────────────────────────────────
    c.[Payment Method Code]                         AS [Customer Payment Method],
    c.[Payment Terms Code]                          AS [Customer Payment Terms],
    al.CommissionGroupCodeOrder,
    c.[Commission Group Code]                       AS CommissionGroupCodeCustomer,
    c.[VAT Bus_ Posting Group]                      AS [VAT Bus_ Posting Group_Customer],
    c.[Gen_ Bus_ Posting Group]                     AS [Gen_ Bus_ Posting Group_Customer],
    c.[Customer Posting Group]                      AS [Customer Posting Group_Customer],
    al.[Special Requests],
    al.[Purchase Group],
    al.[Distribution Channel],

    -- ── Manufacturer ────────────────────────────────────────────────────
    i.Manufacturer,
    v2.Name                                         AS ManufacturerName,
    i.[Advertising Material],
    c.[Credit Manager],
    c.[commercial manager],
    c.[EAC Labels],

    -- ── Geo from order ───────────────────────────────────────────────────
    al.GeographicalZoneFromOrder,
    al.GeographicalZoneDescriptionFromOrder,
    al.[Budget Area],

    -- ── Carry over flags ─────────────────────────────────────────────────
    co.[Future Carry Over],
    c.[Sovracollo Completo],
    c.[Authorized Stores Number]

FROM agg_lines al

-- Item master
INNER JOIN [AZIENDA$Item] i
    ON al.Article = i.No_

-- Variable Code (color description)
INNER JOIN [AZIENDA$Variable Code] vc
    ON al.ColorCode = vc.[Variable Code]
    AND i.[Constant Assortment Var_Grp_] = vc.[Variable Group]

-- Customer
LEFT JOIN [AZIENDA$Customer] c
    ON al.CustomerCode = c.No_

-- Primary vendor
LEFT JOIN [AZIENDA$Vendor] v
    ON i.[Vendor No_] = v.No_

-- Carry-over / SMU / Sold-out flags (SKU level, Configurator=3)
INNER JOIN carry_over co
    ON al.Article = co.[Model Item No_]
    AND al.[Constant Variable Code] = co.[Variable Code 01]

-- Must Buy per article/color
LEFT JOIN must_buy mb
    ON al.[Constant Variable Code] = mb.[Variable Code 01]
    AND al.Article = mb.[Model Item No_]

-- Geographical Zone 1 (from customer)
LEFT JOIN [AZIENDA$Geographical Zone] gz1
    ON al.[Geographical Zone] = gz1.Code

-- Geographical Zone 2 (from customer)
LEFT JOIN [AZIENDA$Geographical Zone] gz2
    ON al.[Geographical Zone 2] = gz2.Code

-- Geographical Zone 3 (ship-to)
LEFT JOIN [AZIENDA$Geographical Zone] gz3
    ON al.ShipToGeographicalZone2 = gz3.Code

-- Manufacturer vendor
LEFT JOIN [AZIENDA$Vendor] v2
    ON i.Manufacturer = v2.No_

-- Landed cost (avg Standard Cost per model)
LEFT JOIN landed_cost lc
    ON al.Article = lc.No_

-- Customer cross-reference per article/color
LEFT JOIN cross_ref_cliente crc
    ON al.Article           = crc.[Model Item No_]
    AND al.[Constant Variable Code] = crc.[Constant Variable Code]
    AND al.[Bill-to Customer No_]   = crc.[Cross-Reference Type No_];
