/**
 * Portafoglio Ordini — query PostgreSQL su tabelle nav_pf_*.
 *
 * Produce lo stesso output della query SQL Server in packages/nav/src/statistics/portafoglio.ts,
 * ma lavora sulle repliche locali anziché su NAV SQL Server direttamente.
 * I campi pre-aggregati (date_prenotazione, ddt_picking) sono già materializzati dal sync.
 */

import type { PrismaClient } from '@prisma/client';

import type { PortafoglioParams, PortafoglioRow } from '@luke/nav';

/**
 * Esegue il portafoglio ordini su PostgreSQL (tabelle nav_pf_*).
 * Produce lo stesso set di colonne del path SQL Server per compatibilità con buildPortafoglioXlsx.
 */
export async function queryPortafoglioFromPg(
  prisma: PrismaClient,
  params: PortafoglioParams,
): Promise<PortafoglioRow[]> {
  const { seasonCode, trademarkCode, salespersonCode, customerCode } = params;

  const sqlParams: unknown[] = [seasonCode, trademarkCode];
  let pi = 3;

  const spFilter = salespersonCode
    ? `AND sh."salespersonCode" = $${pi++}`
    : '';
  if (salespersonCode) sqlParams.push(salespersonCode);

  const custFilter = customerCode
    ? `AND sh."sellToCustomerNo" = $${pi++}`
    : '';
  if (customerCode) sqlParams.push(customerCode);

  const sql = `
WITH

-- CTE 0: attributi articolo per modello — 1 riga per modelItemNo
-- nav_pf_item contiene solo rel=3 (barcode/SKU); modelItemNo punta al codice usato nelle sales line
item_attrs AS (
  SELECT DISTINCT ON (i."modelItemNo")
    i."modelItemNo"                    AS no_,
    i.description,
    i."description2",
    i."collectionCode",
    i."lineCode",
    i."seasonTypology",
    i."productFamily",
    i."productSex",
    i."shipmentPriority",
    i."innovationDegree",
    i."heelHeight",
    i."endCustomerPriceGap",
    i."marketSegment",
    i."productTypology",
    i."mainMaterial",
    i."soleMaterial",
    i."vendorNo",
    i.manufacturer,
    i."advertisingMaterial",
    i."countryRegionOfOriginCode",
    i."constantAssortmentVarGrp"
  FROM nav_pf_item i
  WHERE i."configuratorRelation" = 3
  ORDER BY i."modelItemNo"
),

-- CTE 1: landed cost medio per modello (SKU con standard_cost > 0)
landed_cost AS (
  SELECT
    i."modelItemNo"                       AS no_,
    AVG(COALESCE(i."standardCost", 0))     AS "landed Cost"
  FROM nav_pf_item i
  WHERE i."configuratorRelation" = 3
    AND COALESCE(i."standardCost", 0) > 0
  GROUP BY i."modelItemNo"
),

-- CTE 2: carry over / SMU / sold out — 1 riga per (modello, colore)
carry_over AS (
  SELECT DISTINCT ON (i."modelItemNo", i."variableCode01")
    i."modelItemNo"                       AS "Model Item No_",
    i."variableCode01"                    AS "Variable Code 01",
    i.smu                                 AS "Smu",
    i."carryOver"                          AS "Carry Over",
    i."futureCarryOver"                   AS "Future Carry Over",
    i."soldOut"                            AS "Sold Out",
    i."soldOutDate"                       AS "Sold Out Date",
    i."salesPurchaseStatusItem"          AS "Sales_Purchase Status - Item",
    i."salesPurchaseStatusDate"          AS "Sales_Purchase Status Date",
    i."potentialSoldOut"                  AS "Potential Sold Out",
    COALESCE(i."minimumOrderQuantity", 0) AS "MOQ"
  FROM nav_pf_item i
  WHERE i."configuratorRelation" = 3
  ORDER BY i."modelItemNo", i."variableCode01"
),

-- CTE 3: must buy per modello/colore — 1 riga per (modello, colore)
must_buy AS (
  SELECT DISTINCT ON (i."modelItemNo", i."variableCode01")
    i."mustBuy"        AS "Must Buy",
    i."variableCode01" AS "Variable Code 01",
    i."modelItemNo"   AS "Model Item No_"
  FROM nav_pf_item i
  WHERE i."configuratorRelation" = 3
  ORDER BY i."modelItemNo", i."variableCode01"
),

-- CTE 4: righe ordine base
base_lines AS (
  SELECT
    CASE sl."documentType" WHEN 1 THEN 'SALES' WHEN 5 THEN 'RETURNS' ELSE '' END AS "DocumentType",
    sl.type                                                     AS "Type",
    sl.no_                                                      AS "No_",
    sl."customerOrderRef"                                       AS "Customer Order Ref_",
    sl.reference                                                AS "Reference",
    sl."genBusPostingGroup"                                    AS "Gen_ Bus_ Posting Group",
    sl."vatBusPostingGroup"                                    AS "VAT Bus_ Posting Group",
    she."warehouseSpecialityCode"                               AS "CodSpecialitaOrdine",
    sh."customerPostingGroup"                                   AS "Customer Posting Group",
    sl."unitOfMeasure"                                          AS "Unit of Measure",
    sl."constantVariableCode"                                   AS "Constant Variable Code",
    sl."assortmentCode"                                          AS "Assortment Code",
    sl."deleteReason"                                            AS "Delete Reason",
    sl."salesPurchaseStatusCode"                               AS "Sales_Purchase Status Code",
    sl."salesPurchaseStatusItem"                               AS "Sales_Purchase Status - Item",
    sl."deleteDate"                                              AS "Delete Date",
    sl."customerPriceGroup"                                     AS "Customer Price Group",
    sl."averageUnitPrice"                                       AS "Average Unit Price",
    sh."orderDate"                                               AS "Order Date",
    sh."subject1"                                                AS "Subject 1",
    sp2.name                                                    AS "Subject1Name",
    sh."subject2"                                                AS "Subject 2",
    sp3.name                                                    AS "Subject2Name",
    she."subject3"                                               AS "Subject 3",
    sp4.name                                                    AS "Subject3Name",
    she."subject4"                                               AS "Subject 4",
    sp5.name                                                    AS "Subject4Name",
    sp1.code                                                    AS "CapozonaCodice",
    sp1.name                                                    AS "Capozona",
    sh."salespersonCode"                                         AS "Salesperson Code",
    sp.name                                                     AS "Salesperson",
    sl."constantVariableCode"                                   AS "ColorCode",
    sh."billToCustomerNo"                                      AS "Bill-to Customer No_",
    sh."billToName"                                             AS "Bill-to Name",
    sh."sellToCustomerNo"                                      AS "Sell-to Customer No_",
    sl."documentNo"                                              AS "Document No_",
    sl."lineNo"                                                  AS "Line No_",
    CASE sh."orderType"
      WHEN 0  THEN 'Progr'    WHEN 1 THEN 'Riass.'  WHEN 2  THEN 'Pronto'
      WHEN 3  THEN 'Stock'    WHEN 4 THEN 'Sost.'   WHEN 5  THEN 'PreSeason'
      WHEN 17 THEN 'Commerciale'                     WHEN 18 THEN 'Selection'
      ELSE '?'
    END                                                         AS "OrderType",
    LPAD(EXTRACT(MONTH FROM sh."orderDate")::TEXT, 2, '0') || '/' ||
      CASE
        WHEN EXTRACT(DAY FROM sh."orderDate") < 11 THEN '1'
        WHEN EXTRACT(DAY FROM sh."orderDate") < 21 THEN '2'
        ELSE '3'
      END                                                       AS "OrderPeriod",
    -- Sold
    CASE sl."documentType"
      WHEN 1 THEN  COALESCE(sl."noOfPairs", 0)
      ELSE        -COALESCE(sl."noOfPairs", 0)
    END                                                         AS "PairsSold",
    CASE sl."documentType"
      WHEN 1 THEN  COALESCE(sl.quantity, 0)
      ELSE        -COALESCE(sl.quantity, 0)
    END                                                         AS "QuantitySold",
    sh."currencyCode"                                            AS "Currency Code",
    CASE sl."documentType"
      WHEN 1 THEN  COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0)
      ELSE        -(COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0))
    END                                                         AS "ValueSold",
    -- Shipped
    COALESCE(sl."quantityShipped", 0)                            AS "QuantityShipped",
    CASE WHEN COALESCE(sl.quantity, 0) > 0
      THEN COALESCE(sl."quantityShipped", 0) / NULLIF(sl.quantity, 0) * COALESCE(sl."noOfPairs", 0)
      ELSE 0 END                                                AS "PairsShipped",
    CASE WHEN COALESCE(sl.quantity, 0) > 0
      THEN COALESCE(sl."quantityShipped", 0) / NULLIF(sl.quantity, 0) *
           (CASE sl."documentType"
              WHEN 1 THEN  COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0)
              ELSE        -(COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0))
            END)
      ELSE 0 END                                                AS "ValueShipped",
    -- Invoiced
    CASE sl."documentType" WHEN 1 THEN COALESCE(sl."quantityInvoiced", 0) ELSE 0 END AS "QuantityInvoiced",
    CASE sl."documentType"
      WHEN 1 THEN CASE WHEN COALESCE(sl.quantity, 0) > 0
        THEN COALESCE(sl."quantityInvoiced", 0) / NULLIF(sl.quantity, 0) * COALESCE(sl."noOfPairs", 0)
        ELSE 0 END
      ELSE 0 END                                                AS "PairsInvoiced",
    CASE sl."documentType"
      WHEN 1 THEN CASE WHEN COALESCE(sl.quantity, 0) > 0
        THEN COALESCE(sl."quantityInvoiced", 0) / NULLIF(sl.quantity, 0) *
             (COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0))
        ELSE 0 END
      ELSE 0 END                                                AS "ValueInvoiced",
    -- Returned
    -COALESCE(sl."returnQtyReceived", 0)                        AS "QuantityReturned",
    CASE WHEN COALESCE(sl.quantity, 0) > 0
      THEN -COALESCE(sl."returnQtyReceived", 0) / NULLIF(sl.quantity, 0) * COALESCE(sl."noOfPairs", 0)
      ELSE 0 END                                                AS "PairsReturned",
    CASE WHEN COALESCE(sl.quantity, 0) > 0
      THEN COALESCE(sl."returnQtyReceived", 0) / NULLIF(sl.quantity, 0) *
           (CASE sl."documentType"
              WHEN 1 THEN  COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0)
              ELSE        -(COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0))
            END)
      ELSE 0 END                                                AS "ValueReturned",
    -- Credited
    CASE sl."documentType" WHEN 5 THEN -COALESCE(sl."quantityInvoiced", 0) ELSE 0 END AS "QuantityCredited",
    CASE sl."documentType"
      WHEN 5 THEN CASE WHEN COALESCE(sl.quantity, 0) > 0
        THEN -COALESCE(sl."quantityInvoiced", 0) / NULLIF(sl.quantity, 0) * COALESCE(sl."noOfPairs", 0)
        ELSE 0 END
      ELSE 0 END                                                AS "PairsCredited",
    CASE sl."documentType"
      WHEN 5 THEN CASE WHEN COALESCE(sl.quantity, 0) > 0
        THEN COALESCE(sl."quantityInvoiced", 0) / NULLIF(sl.quantity, 0) *
             ABS(COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0))
        ELSE 0 END
      ELSE 0 END                                                AS "ValueCredited",
    -- Commissions
    COALESCE(sl."subject1Commission",   0)                      AS "ProvvigioneSoggetto1",
    COALESCE(sl."subject2Commission",   0)                      AS "ProvvigioneSoggetto2",
    COALESCE(sl."subject3Commission",   0)                      AS "ProvvigioneSoggetto3",
    COALESCE(sl."subject4Commission",   0)                      AS "ProvvigioneSoggetto4",
    COALESCE(sl."areaManagerCommission",0)                      AS "ProvvigioneCapozona",
    COALESCE(sl."salespersonCommission", 0)                      AS "ProvvigioneAgente",
    -- Ship-to
    sl."returnReasonCode"                                       AS "ReturnReasonCode",
    sh."shipToCode"                                             AS "Ship-to Code",
    sh."shipToName"                                             AS "ClienteSpedizione",
    sh."shipToName2"                                           AS "ClienteSpedizione2",
    sh."shipToAddress"                                          AS "IndirizzoSpedizione",
    sh."shipToAddress2"                                        AS "IndirizzoSpedizione2",
    sh."shipToCity"                                             AS "CittaSpedizione",
    sh."shipToPostCode"                                        AS "CodicePostaleSpedizione",
    sh."shipToCounty"                                           AS "CountySpedizione",
    sl."requestedDeliveryDate"                                  AS "Requested Delivery Date",
    -- Ready For Shipping (pre-aggregated)
    COALESCE(ps."pairsTotale",        0)                         AS "PairsReadyForShippingTotale",
    COALESCE(ps."qtyTotale",          0)                         AS "QuantityReadyForShippingTotale",
    CASE WHEN COALESCE(sl.quantity, 0) > 0
      THEN COALESCE(ps."qtyTotale", 0) / NULLIF(sl.quantity, 0) *
           (CASE sl."documentType"
              WHEN 1 THEN  COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0)
              ELSE        -(COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0))
            END)
      ELSE 0 END                                                AS "ValueReadyForShippingTotale",
    COALESCE(ps."pairsRilasciate",    0)                         AS "PairsReadyForShippingRilasciate",
    COALESCE(ps."qtyRilasciate",      0)                         AS "QuantityReadyForShippingRilasciate",
    CASE WHEN COALESCE(sl.quantity, 0) > 0
      THEN COALESCE(ps."qtyRilasciate", 0) / NULLIF(sl.quantity, 0) *
           (CASE sl."documentType"
              WHEN 1 THEN  COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0)
              ELSE        -(COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0))
            END)
      ELSE 0 END                                                AS "ValueReadyForShippingRilasciate",
    COALESCE(ps."pairsAperte",        0)                         AS "PairsReadyForShippingAperte",
    COALESCE(ps."qtyAperte",          0)                         AS "QuantityReadyForShippingAperte",
    CASE WHEN COALESCE(sl.quantity, 0) > 0
      THEN COALESCE(ps."qtyAperte", 0) / NULLIF(sl.quantity, 0) *
           (CASE sl."documentType"
              WHEN 1 THEN  COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0)
              ELSE        -(COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0))
            END)
      ELSE 0 END                                                AS "ValueReadyForShippingAperte",
    COALESCE(ps."pairsDaInviareWmsps", 0)                      AS "PairsReadyForShippingDaInviareWMSps",
    COALESCE(ps."qtyDaInviareWmsps",   0)                      AS "QuantityReadyForShippingDaInviareWMSps",
    CASE WHEN COALESCE(sl.quantity, 0) > 0
      THEN COALESCE(ps."qtyDaInviareWmsps", 0) / NULLIF(sl.quantity, 0) *
           (CASE sl."documentType"
              WHEN 1 THEN  COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0)
              ELSE        -(COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0))
            END)
      ELSE 0 END                                                AS "ValueReadyForShippingDaInviareWMSps",
    COALESCE(ps."pairsInviatoWmsps",    0)                      AS "PairsReadyForShippingInviatoWMSps",
    COALESCE(ps."qtyInviatoWmsps",      0)                      AS "QuantityReadyForShippingInviatoWMSps",
    CASE WHEN COALESCE(sl.quantity, 0) > 0
      THEN COALESCE(ps."qtyInviatoWmsps", 0) / NULLIF(sl.quantity, 0) *
           (CASE sl."documentType"
              WHEN 1 THEN  COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0)
              ELSE        -(COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0))
            END)
      ELSE 0 END                                                AS "ValueReadyForShippingInviatoWMSps",
    COALESCE(ps."pairsEvasoWmsps",      0)                      AS "PairsReadyForShippingEvasoWMSps",
    COALESCE(ps."qtyEvasoWmsps",        0)                      AS "QuantityReadyForShippingEvasoWMSps",
    CASE WHEN COALESCE(sl.quantity, 0) > 0
      THEN COALESCE(ps."qtyEvasoWmsps", 0) / NULLIF(sl.quantity, 0) *
           (CASE sl."documentType"
              WHEN 1 THEN  COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0)
              ELSE        -(COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0))
            END)
      ELSE 0 END                                                AS "ValueReadyForShippingEvasoWMSps",
    -- Payment / discount
    sh."paymentTermsCode"                                       AS "Payment Terms Code",
    sh."paymentMethodCode"                                      AS "Payment Method Code",
    sh."invoiceDiscountCalculation"                             AS "CalcoloScontoFattura",
    COALESCE(sh."invoiceDiscountValue", 0)                      AS "ScontoFattura",
    CASE WHEN sh.consignment = 1 THEN 'SI' ELSE 'NO' END        AS "ContoVendita",
    COALESCE(sh."rightOnReturnPct", 0)                         AS "PercentualeDirittoAlReso",
    sh.note                                                     AS "Note",
    sh."campaignNo"                                              AS "Campaign No_",
    NULL::TEXT                                                  AS "event code",
    COALESCE(sl."lineDiscountPct", 0)                           AS "ScontoRiga",
    COALESCE(sl."discount1Pct", 0)                              AS "Sconto1Riga",
    COALESCE(sl."discount2Pct", 0)                              AS "Sconto2Riga",
    COALESCE(sl."discount3Pct", 0)                              AS "Sconto3Riga",
    sh."securitiesReceived"                                      AS "Securities Received",
    CASE WHEN sh.anomalous = 1     THEN 'X' ELSE '' END         AS "Anomalo",
    CASE WHEN sh."notAnomalous" = 1 THEN 'X' ELSE '' END         AS "NonAnomalo",
    sh."anomalousDate"                                           AS "Anomalous Date",
    CASE WHEN sh.checked = 1      THEN 'X' ELSE '' END          AS "Verificato",
    sh."checkedDate"                                             AS "Checked Date",
    sh."budgetNo"                                                AS "Budget No_",
    sh."courseDate"                                              AS "DataDecorrenza",
    sh."kimoFashionSoNo"                                       AS "KimoOrder",
    sh."shipmentMethodCode"                                     AS "ShipmentMethodCode",
    smeth.description                                           AS "ShipmentMethodDescription",
    sh."transportReasonCode"                                    AS "Transport Reason Code",
    trc.description                                             AS "TransportReasonCodeDescription",
    sl."locationCode"                                            AS "Location Code",
    sh."shippingAgentCode"                                      AS "Shipping Agent Code",
    sh."shippingAgentServiceCode"                              AS "Shipping Agent Service Code",
    dp."dateReservation"                                         AS "Date Reservation",
    sh."fastShipping"                                            AS "Fast Shipping",
    sh."commissionGroupCode"                                    AS "CommissionGroupCodeOrder",
    sh."geographicalZone"                                        AS "GeographicalZoneFromOrder",
    gz_ord.description                                          AS "GeographicalZoneDescriptionFromOrder",
    bh."budgetArea"                                              AS "Budget Area",
    sl."modelCrossReference"                                    AS "Model Cross Reference",
    sh."shortcutDimension2Code"                                AS "trademark code",
    sh."sellingSeasonCode"                                      AS "Season Code"

  FROM nav_pf_sales_line sl
  INNER JOIN nav_pf_sales_header sh
    ON sl."documentType" = sh."documentType"
    AND sl."documentNo" = sh.no_
  LEFT JOIN nav_pf_salesperson sp
    ON sh."salespersonCode" = sp.code
  LEFT JOIN nav_pf_ddt_picking ps
    ON sl."documentNo" = ps."orderNo"
    AND sl."lineNo" = ps."orderLineNo"
  LEFT JOIN nav_pf_shipment_method smeth
    ON sh."shipmentMethodCode" = smeth.code
  LEFT JOIN nav_pf_salesperson sp1
    ON sh."areaManagerCode" = sp1.code
  LEFT JOIN nav_pf_salesperson sp2
    ON sh."subject1" = sp2.code
  LEFT JOIN nav_pf_salesperson sp3
    ON sh."subject2" = sp3.code
  LEFT JOIN nav_pf_transport_reason trc
    ON sh."transportReasonCode" = trc.code
  LEFT JOIN nav_pf_date_prenotazione dp
    ON sl."documentNo" = dp."salesDocumentNo"
    AND sl."lineNo" = dp."salesLineNo"
  LEFT JOIN nav_pf_geo_zone gz_ord
    ON sh."geographicalZone" = gz_ord.code
  LEFT JOIN nav_pf_budget_header bh
    ON sh."budgetNo" = bh.no_
  LEFT JOIN nav_pf_sales_header_ext she
    ON sh.no_ = she."documentNo"
    AND sh."documentType" = she."documentType"
  LEFT JOIN nav_pf_salesperson sp4
    ON she."subject3" = sp4.code
  LEFT JOIN nav_pf_salesperson sp5
    ON she."subject4" = sp5.code

  WHERE CASE sl."documentType" WHEN 1 THEN 'SALES' WHEN 5 THEN 'RETURNS' ELSE '' END <> ''
    AND sl.type IN (19, 20)
    AND sh."sellingSeasonCode" = $1
    AND sh."shortcutDimension2Code" = $2
    ${spFilter}
    ${custFilter}
),

-- CTE 5: aggregazione + arricchimento cliente/ship-to
agg_lines AS (
  SELECT
    bl."Document No_", bl."Line No_", bl."Customer Order Ref_", bl."Reference",
    bl."Gen_ Bus_ Posting Group", bl."VAT Bus_ Posting Group", bl."Customer Posting Group",
    bl."No_"                                    AS "Article",
    bl."Constant Variable Code",
    bl."Salesperson Code", bl."Salesperson",
    bl."CapozonaCodice", bl."Capozona",
    bl."Subject 1", bl."Subject1Name",
    bl."Subject 2", bl."Subject2Name",
    bl."Subject 3", bl."Subject3Name",
    bl."Subject 4", bl."Subject4Name",
    bl."Sales_Purchase Status Code",
    bl."Sales_Purchase Status - Item",
    bl."Delete Reason", bl."Delete Date",
    bl."Assortment Code", bl."Order Date",
    bl."Bill-to Customer No_", bl."Bill-to Name",
    bl."CodSpecialitaOrdine", bl."ColorCode",
    bl."Sell-to Customer No_"                   AS "CustomerCode",
    c."geographicalZone"                         AS "Geographical Zone",
    c.name                                      AS "CustomerName",
    c."blockedForAssignments"                   AS "Blocked for Assignments",
    bl."OrderPeriod", bl."Currency Code",
    SUM(bl."QuantitySold")                      AS "QuantitySold",
    SUM(bl."PairsSold")                         AS "PairsSold",
    SUM(bl."ValueSold")                         AS "ValueSold",
    SUM(bl."QuantityShipped")                   AS "QuantityShipped",
    SUM(bl."PairsShipped")                      AS "PairsShipped",
    SUM(bl."ValueShipped")                      AS "ValueShipped",
    SUM(bl."QuantityInvoiced")                  AS "QuantityInvoiced",
    SUM(bl."PairsInvoiced")                     AS "PairsInvoiced",
    SUM(bl."ValueInvoiced")                     AS "ValueInvoiced",
    SUM(bl."QuantityReadyForShippingTotale")     AS "QuantityReadyForShippingTotale",
    SUM(bl."PairsReadyForShippingTotale")        AS "PairsReadyForShippingTotale",
    SUM(bl."ValueReadyForShippingTotale")        AS "ValueReadyForShippingTotale",
    SUM(bl."QuantityReadyForShippingRilasciate") AS "QuantityReadyForShippingRilasciate",
    SUM(bl."PairsReadyForShippingRilasciate")    AS "PairsReadyForShippingRilasciate",
    SUM(bl."ValueReadyForShippingRilasciate")    AS "ValueReadyForShippingRilasciate",
    SUM(bl."QuantityReadyForShippingAperte")     AS "QuantityReadyForShippingAperte",
    SUM(bl."PairsReadyForShippingAperte")        AS "PairsReadyForShippingAperte",
    SUM(bl."ValueReadyForShippingAperte")        AS "ValueReadyForShippingAperte",
    SUM(bl."QuantityReadyForShippingDaInviareWMSps") AS "QuantityReadyForShippingDaInviareWMSps",
    SUM(bl."PairsReadyForShippingDaInviareWMSps")         AS "PairsReadyForShippingDaInviareWMSps",
    SUM(bl."ValueReadyForShippingDaInviareWMSps")         AS "ValueReadyForShippingDaInviareWMSps",
    SUM(bl."QuantityReadyForShippingInviatoWMSps")        AS "QuantityReadyForShippingInviatoWMSps",
    SUM(bl."PairsReadyForShippingInviatoWMSps")           AS "PairsReadyForShippingInviatoWMSps",
    SUM(bl."ValueReadyForShippingInviatoWMSps")           AS "ValueReadyForShippingInviatoWMSps",
    SUM(bl."QuantityReadyForShippingEvasoWMSps")          AS "QuantityReadyForShippingEvasoWMSps",
    SUM(bl."PairsReadyForShippingEvasoWMSps")             AS "PairsReadyForShippingEvasoWMSps",
    SUM(bl."ValueReadyForShippingEvasoWMSps")             AS "ValueReadyForShippingEvasoWMSps",
    SUM(bl."QuantityReturned")                  AS "QuantityReturned",
    SUM(bl."PairsReturned")                     AS "PairsReturned",
    SUM(bl."ValueReturned")                     AS "ValueReturned",
    SUM(bl."QuantityCredited")                  AS "QuantityCredited",
    SUM(bl."PairsCredited")                     AS "PairsCredited",
    SUM(bl."ValueCredited")                     AS "ValueCredited",
    bl."ProvvigioneAgente", bl."ProvvigioneCapozona",
    bl."ProvvigioneSoggetto1", bl."ProvvigioneSoggetto2",
    bl."ProvvigioneSoggetto3", bl."ProvvigioneSoggetto4",
    c."geographicalZone2"                       AS "Geographical Zone 2",
    bl."OrderType", bl."ReturnReasonCode", bl."DocumentType",
    bl."Ship-to Code", bl."ClienteSpedizione", bl."ClienteSpedizione2",
    bl."IndirizzoSpedizione", bl."IndirizzoSpedizione2",
    bl."CittaSpedizione", bl."CodicePostaleSpedizione", bl."CountySpedizione",
    bl."Requested Delivery Date",
    bl."Payment Terms Code", bl."Payment Method Code",
    bl."ShipmentMethodCode", bl."ShipmentMethodDescription",
    bl."CalcoloScontoFattura", bl."Customer Price Group",
    bl."ScontoFattura", bl."ScontoRiga",
    bl."Sconto1Riga", bl."Sconto2Riga", bl."Sconto3Riga",
    c."eMail"                                    AS "E-Mail",
    bl."ContoVendita", bl."PercentualeDirittoAlReso", bl."Note",
    bl."Campaign No_", bl."event code",
    bl."Securities Received",
    bl."Anomalo", bl."NonAnomalo", bl."Anomalous Date",
    bl."Verificato", bl."Checked Date",
    bl."Budget No_", bl."DataDecorrenza", bl."KimoOrder",
    she2."oldOrderNo"                           AS "Old Order No_",
    bl."Season Code", bl."Transport Reason Code",
    bl."TransportReasonCodeDescription",
    bl."Location Code", bl."Shipping Agent Code", bl."Shipping Agent Service Code",
    bl."Date Reservation", bl."Fast Shipping",
    sta."geographicalZone2"                     AS "ShipToGeographicalZone2",
    sta."countryRegionCode"                     AS "ShipTpCountryRegionCode",
    bl."CommissionGroupCodeOrder",
    she2."specialRequests"                       AS "Special Requests",
    c."purchaseGroup"                            AS "Purchase Group",
    c."distributionChannel"                      AS "Distribution Channel",
    bl."GeographicalZoneFromOrder", bl."GeographicalZoneDescriptionFromOrder",
    bl."Budget Area", bl."Model Cross Reference",
    bl."trademark code"

  FROM base_lines bl
  LEFT JOIN nav_pf_customer c
    ON bl."Sell-to Customer No_" = c.no_
  LEFT JOIN nav_pf_sales_header_ext she2
    ON bl."Document No_" = she2."documentNo"
  LEFT JOIN nav_pf_ship_to_address sta
    ON bl."Sell-to Customer No_" = sta."customerNo"
    AND bl."Ship-to Code" = sta.code

  GROUP BY
    bl."Document No_", bl."Line No_", bl."Customer Order Ref_", bl."Reference",
    bl."Gen_ Bus_ Posting Group", bl."VAT Bus_ Posting Group", bl."Customer Posting Group",
    bl."No_", bl."Constant Variable Code", bl."Salesperson Code", bl."Salesperson",
    bl."CapozonaCodice", bl."Capozona",
    bl."Subject 1", bl."Subject1Name", bl."Subject 2", bl."Subject2Name",
    bl."Subject 3", bl."Subject3Name", bl."Subject 4", bl."Subject4Name",
    bl."Sales_Purchase Status Code", bl."Sales_Purchase Status - Item",
    bl."Delete Reason", bl."Delete Date", bl."Assortment Code", bl."Order Date",
    bl."Bill-to Customer No_", bl."Bill-to Name", bl."CodSpecialitaOrdine",
    bl."ColorCode", bl."Sell-to Customer No_",
    c."geographicalZone", c.name, c."blockedForAssignments",
    bl."OrderPeriod", bl."Currency Code",
    bl."ProvvigioneAgente", bl."ProvvigioneCapozona",
    bl."ProvvigioneSoggetto1", bl."ProvvigioneSoggetto2",
    bl."ProvvigioneSoggetto3", bl."ProvvigioneSoggetto4",
    c."geographicalZone2", bl."OrderType", bl."ReturnReasonCode", bl."DocumentType",
    bl."Ship-to Code", bl."ClienteSpedizione", bl."ClienteSpedizione2",
    bl."IndirizzoSpedizione", bl."IndirizzoSpedizione2", bl."CittaSpedizione",
    bl."CodicePostaleSpedizione", bl."CountySpedizione", bl."Requested Delivery Date",
    bl."Payment Terms Code", bl."Payment Method Code", bl."ShipmentMethodCode",
    bl."ShipmentMethodDescription", bl."CalcoloScontoFattura", bl."Customer Price Group",
    bl."ScontoFattura", bl."ScontoRiga", bl."Sconto1Riga", bl."Sconto2Riga", bl."Sconto3Riga",
    c."eMail", bl."ContoVendita", bl."PercentualeDirittoAlReso", bl."Note",
    bl."Campaign No_", bl."event code", bl."Securities Received",
    bl."Anomalo", bl."NonAnomalo", bl."Anomalous Date", bl."Verificato", bl."Checked Date",
    bl."Budget No_", bl."DataDecorrenza", bl."KimoOrder", she2."oldOrderNo",
    bl."Season Code", bl."Transport Reason Code", bl."TransportReasonCodeDescription",
    bl."Location Code", bl."Shipping Agent Code", bl."Shipping Agent Service Code",
    bl."Date Reservation", bl."Fast Shipping",
    sta."geographicalZone2", sta."countryRegionCode",
    bl."CommissionGroupCodeOrder", she2."specialRequests",
    c."purchaseGroup", c."distributionChannel",
    bl."GeographicalZoneFromOrder", bl."GeographicalZoneDescriptionFromOrder",
    bl."Budget Area", bl."Model Cross Reference", bl."trademark code"
)

-- Final SELECT
SELECT
  al."CustomerCode"                                     AS "CustomerCheckCode",
  al."CustomerName"                                     AS "CustomerCheckName",
  al."Salesperson Code"                                 AS "SalesPersonCheckCode",
  al."Salesperson"                                      AS "SalesPersonCheckName",
  al."Document No_", al."Line No_",
  al."Customer Order Ref_", al."Reference",
  al."Gen_ Bus_ Posting Group", al."VAT Bus_ Posting Group", al."Customer Posting Group",
  al."Article", al."Constant Variable Code",
  al."Model Cross Reference"                            AS "CrossReferenceOrdine",
  NULL::TEXT                                            AS "CrossReferenceAnagrafica",
  al."Salesperson Code", al."Salesperson",
  al."CapozonaCodice", al."Capozona",
  al."Subject 1", al."Subject1Name",
  al."Subject 2", al."Subject2Name",
  al."Subject 3", al."Subject3Name",
  al."Subject 4", al."Subject4Name",
  al."Sales_Purchase Status Code", al."Sales_Purchase Status - Item",
  al."Delete Reason", al."Delete Date",
  al."Assortment Code", al."Order Date",
  c."keyAccount"                                        AS "Key Account",
  al."Bill-to Customer No_", al."Bill-to Name",
  c."warehouseSpecialityCode"                           AS "CodSpecialitaCliente",
  al."CodSpecialitaOrdine",
  c."languageCode"                                       AS "Language Code",
  c."fastShipment"                                       AS "Customer_Fast Shipment",
  al."ColorCode", al."CustomerCode",
  al."Geographical Zone"                                AS "GeographicalZone",
  al."CustomerName",
  al."Blocked for Assignments",
  c."reasonBlockCode"                                   AS "Reason Block Code",
  al."OrderPeriod", al."Currency Code",
  al."QuantitySold", al."PairsSold", al."ValueSold",
  al."QuantityShipped", al."PairsShipped", al."ValueShipped",
  al."QuantityInvoiced", al."PairsInvoiced", al."ValueInvoiced",
  al."QuantityReadyForShippingTotale", al."PairsReadyForShippingTotale", al."ValueReadyForShippingTotale",
  al."QuantityReadyForShippingRilasciate", al."PairsReadyForShippingRilasciate", al."ValueReadyForShippingRilasciate",
  al."QuantityReadyForShippingAperte", al."PairsReadyForShippingAperte", al."ValueReadyForShippingAperte",
  al."QuantityReadyForShippingDaInviareWMSps", al."PairsReadyForShippingDaInviareWMSps", al."ValueReadyForShippingDaInviareWMSps",
  al."QuantityReadyForShippingInviatoWMSps",   al."PairsReadyForShippingInviatoWMSps",   al."ValueReadyForShippingInviatoWMSps",
  al."QuantityReadyForShippingEvasoWMSps",     al."PairsReadyForShippingEvasoWMSps",     al."ValueReadyForShippingEvasoWMSps",
  al."QuantityShipped" + al."QuantityReadyForShippingRilasciate"  AS "QuantityShippedReleased",
  al."PairsShipped"   + al."PairsReadyForShippingRilasciate"      AS "PairsShippedReleased",
  al."ValueShipped"   + al."ValueReadyForShippingRilasciate"      AS "ValueShippedReleased",
  al."QuantityReturned", al."PairsReturned", al."ValueReturned",
  al."QuantityCredited", al."PairsCredited", al."ValueCredited",
  al."ProvvigioneAgente", al."ProvvigioneCapozona",
  al."ProvvigioneSoggetto1", al."ProvvigioneSoggetto2",
  al."ProvvigioneSoggetto3", al."ProvvigioneSoggetto4",
  al."Geographical Zone 2"                              AS "GeographicalZone2",
  al."OrderType", al."ReturnReasonCode", al."DocumentType",
  al."Ship-to Code", al."ClienteSpedizione", al."ClienteSpedizione2",
  al."IndirizzoSpedizione", al."IndirizzoSpedizione2",
  al."CittaSpedizione", al."CodicePostaleSpedizione", al."CountySpedizione",
  al."Requested Delivery Date",
  al."Payment Terms Code", al."Payment Method Code",
  al."ShipmentMethodCode", al."ShipmentMethodDescription",
  al."CalcoloScontoFattura", al."Customer Price Group",
  al."ScontoFattura", al."ScontoRiga",
  al."Sconto1Riga", al."Sconto2Riga", al."Sconto3Riga",
  al."E-Mail", al."ContoVendita", al."PercentualeDirittoAlReso",
  al."Note", al."Campaign No_", al."event code",
  al."Securities Received",
  al."Anomalo", al."NonAnomalo", al."Anomalous Date",
  al."Verificato", al."Checked Date",
  al."Budget No_", al."DataDecorrenza", al."KimoOrder",
  al."Old Order No_",
  c."vatRegistrationNo"                                 AS "VAT Registration No_",
  c."fiscalCode"                                         AS "Fiscal Code",
  i.description                                         AS "Description",
  co."Smu",
  co."Carry Over",
  i."description2"                                       AS "Description 2",
  al."trademark code", al."Season Code",
  i."collectionCode"                                     AS "Collection Code",
  i."lineCode"                                           AS "Line Code",
  vc.description                                        AS "Color",
  gz1.description                                       AS "GeographicalZoneDescription",
  i."seasonTypology"                                     AS "Season Typology",
  i."productFamily"                                      AS "Product Family",
  i."productSex"                                         AS "Product Sex",
  i."shipmentPriority"                                   AS "Shipment Priority",
  i."innovationDegree"                                   AS "Innovation Degree",
  i."heelHeight"                                         AS "Heel Height",
  i."endCustomerPriceGap"                              AS "End Customer Price Gap",
  i."marketSegment"                                      AS "Market Segment",
  i."productTypology"                                    AS "Product Typology",
  i."mainMaterial"                                       AS "Main Material",
  i."soleMaterial"                                       AS "Sole Material",
  mb."Must Buy",
  gz2.description                                       AS "GeographicalZone2Description",
  c."name2"                                              AS "Name 2",
  c.address                                             AS "Address",
  c.city                                                AS "City",
  c.contact                                             AS "Contact",
  c."phoneNo"                                            AS "Phone No_",
  c."countryRegionCode"                                 AS "Country_Region Code",
  c."postCode"                                           AS "Post Code",
  c.county                                              AS "County",
  c."reservationPriority"                                AS "Reservation Priority",
  c."vatRegistrationNo"                                 AS "PartitaIva",
  i."vendorNo"                                           AS "Vendor No_",
  v.name                                                AS "Vendor",
  c."currentRisk"                                        AS "LinceRischioOggi",
  c."riskRating"                                         AS "Risk Rating",
  c."pmFailureAssignedScore"                           AS "PM Failure Assigned Score",
  c."updatedDate"                                        AS "LinceAggiornamentoFile",
  c."updatedType"                                        AS "LinceTipoEvasione",
  c."dueDate"                                            AS "LinceDataEvasione",
  c."internalValuation"                                  AS "Internal Valuation",
  c."valuationDate"                                      AS "Valuation Date",
  c."businessEMail"                                     AS "Business E-Mail",
  lc."landed Cost",
  al."PairsSold" * COALESCE(lc."landed Cost", 0)        AS "EstimatedLandedCostOnSold",
  al."ValueSold" - al."PairsSold" * COALESCE(lc."landed Cost", 0) AS "EstimatedMargin",
  al."ValueSold" * al."ProvvigioneAgente"    / 100.0    AS "EstimatedCommissionSalesPerson",
  al."ValueSold" * al."ProvvigioneCapozona"  / 100.0    AS "EstimatedCommissionAreaManager",
  al."ValueSold" * al."ProvvigioneSoggetto1" / 100.0    AS "EstimatedCommissionSubject1",
  al."ValueSold" * al."ProvvigioneSoggetto2" / 100.0    AS "EstimatedCommissionSubject2",
  al."ValueSold" * al."ProvvigioneSoggetto3" / 100.0    AS "EstimatedCommissionSubject3",
  al."ValueSold" * al."ProvvigioneSoggetto4" / 100.0    AS "EstimatedCommissionSubject4",
  (al."ValueSold" - al."PairsSold" * COALESCE(lc."landed Cost", 0))
    - al."ValueSold" * al."ProvvigioneAgente"    / 100.0
    - al."ValueSold" * al."ProvvigioneCapozona"  / 100.0
    - al."ValueSold" * al."ProvvigioneSoggetto1" / 100.0
    - al."ValueSold" * al."ProvvigioneSoggetto2" / 100.0
    - al."ValueSold" * al."ProvvigioneSoggetto3" / 100.0
    - al."ValueSold" * al."ProvvigioneSoggetto4" / 100.0 AS "EstimatedSecondMargin",
  i."countryRegionOfOriginCode"                       AS "Country_Region of Origin Code",
  co."Sold Out", co."Sold Out Date", co."Sales_Purchase Status Date",
  c."faxNo"                                              AS "Fax No_",
  COALESCE(c."authorizedStoresNumber", 0)               AS "PuntiVendita",
  CASE c."storeDistribution"
    WHEN 3 THEN '3-Dept.Store'  WHEN 2 THEN '2-Indipendent'
    WHEN 1 THEN '1-Chain'       ELSE '0-UNK'
  END                                                   AS "StoreDistribution",
  CASE c."storeImage"
    WHEN 4 THEN '4-Commodity'  WHEN 3 THEN '3-Standard'
    WHEN 2 THEN '2-Premium'    WHEN 1 THEN '1-Image'  ELSE '0-UNK'
  END                                                   AS "StoreImage",
  CASE c."storeType"
    WHEN 3 THEN '3-Footwear'  WHEN 2 THEN '2-Apparel-Footwear-Accessories'
    WHEN 1 THEN '1-Apparel-Footwear'  ELSE '0-UNK'
  END                                                   AS "StoreType",
  c."variousReferences"                                  AS "Various References",
  c."homePage"                                           AS "Home Page",
  c."qualityControl"                                     AS "Quality Control",
  c."oldFebosNo"                                        AS "Old Febos No_",
  c."oldBridgeNo"                                       AS "Old Bridge No_",
  al."Transport Reason Code", al."TransportReasonCodeDescription",
  al."Location Code", al."Shipping Agent Code", al."Shipping Agent Service Code",
  al."Date Reservation", al."Fast Shipping",
  al."ShipToGeographicalZone2",
  gz3.description                                       AS "ShipToGeographicalZone2Description",
  al."ShipTpCountryRegionCode",
  c."paymentMethodCode"                                 AS "Customer Payment Method",
  c."paymentTermsCode"                                  AS "Customer Payment Terms",
  al."CommissionGroupCodeOrder",
  c."commissionGroupCode"                               AS "CommissionGroupCodeCustomer",
  c."vatBusPostingGroup"                               AS "VAT Bus_ Posting Group_Customer",
  c."genBusPostingGroup"                               AS "Gen_ Bus_ Posting Group_Customer",
  c."customerPostingGroup"                              AS "Customer Posting Group_Customer",
  al."Special Requests", al."Purchase Group", al."Distribution Channel",
  i.manufacturer                                        AS "Manufacturer",
  v2.name                                               AS "ManufacturerName",
  i."advertisingMaterial"                                AS "Advertising Material",
  c."creditManager"                                      AS "Credit Manager",
  NULL::TEXT                                            AS "commercial manager",
  c."eacLabels"                                          AS "EAC Labels",
  al."GeographicalZoneFromOrder", al."GeographicalZoneDescriptionFromOrder",
  al."Budget Area",
  co."Future Carry Over",
  c."sovracolloCompleto"                                 AS "Sovracollo Completo",
  c."authorizedStoresNumber"                            AS "Authorized Stores Number"

FROM agg_lines al
LEFT JOIN item_attrs i
  ON al."Article" = i.no_
LEFT JOIN nav_pf_variable_code vc
  ON al."ColorCode" = vc."variableCode"
  AND i."constantAssortmentVarGrp" = vc."variableGroup"
LEFT JOIN nav_pf_customer c
  ON al."CustomerCode" = c.no_
LEFT JOIN nav_pf_vendor v
  ON i."vendorNo" = v.no_
LEFT JOIN carry_over co
  ON al."Article" = co."Model Item No_"
  AND al."Constant Variable Code" = co."Variable Code 01"
LEFT JOIN must_buy mb
  ON al."Constant Variable Code" = mb."Variable Code 01"
  AND al."Article" = mb."Model Item No_"
LEFT JOIN nav_pf_geo_zone gz1
  ON al."Geographical Zone" = gz1.code
LEFT JOIN nav_pf_geo_zone gz2
  ON al."Geographical Zone 2" = gz2.code
LEFT JOIN nav_pf_geo_zone gz3
  ON al."ShipToGeographicalZone2" = gz3.code
LEFT JOIN nav_pf_vendor v2
  ON i.manufacturer = v2.no_
LEFT JOIN landed_cost lc
  ON al."Article" = lc.no_
`;

  const rows = await prisma.$queryRawUnsafe<PortafoglioRow[]>(sql, ...sqlParams);
  return rows;
}
