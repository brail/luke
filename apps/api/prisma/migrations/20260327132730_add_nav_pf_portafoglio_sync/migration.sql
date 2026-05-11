-- CreateTable
CREATE TABLE "nav_pf_sync_state" (
    "tableName" TEXT NOT NULL,
    "lastRowversion" BIGINT NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "lastDurationMs" INTEGER,

    CONSTRAINT "nav_pf_sync_state_pkey" PRIMARY KEY ("tableName")
);

-- CreateTable
CREATE TABLE "nav_pf_sales_header" (
    "no_" TEXT NOT NULL,
    "documentType" INTEGER NOT NULL,
    "orderDate" TIMESTAMP(3),
    "sellToCustomerNo" TEXT,
    "billToCustomerNo" TEXT,
    "billToName" TEXT,
    "salespersonCode" TEXT,
    "areaManagerCode" TEXT,
    "subject1" TEXT,
    "subject2" TEXT,
    "currencyCode" TEXT,
    "shipToCode" TEXT,
    "shipToName" TEXT,
    "shipToName2" TEXT,
    "shipToAddress" TEXT,
    "shipToAddress2" TEXT,
    "shipToCity" TEXT,
    "shipToPostCode" TEXT,
    "shipToCounty" TEXT,
    "shipmentMethodCode" TEXT,
    "transportReasonCode" TEXT,
    "shippingAgentCode" TEXT,
    "shippingAgentServiceCode" TEXT,
    "paymentTermsCode" TEXT,
    "paymentMethodCode" TEXT,
    "invoiceDiscountCalculation" TEXT,
    "invoiceDiscountValue" DOUBLE PRECISION,
    "consignment" INTEGER,
    "rightOnReturnPct" DOUBLE PRECISION,
    "note" TEXT,
    "campaignNo" TEXT,
    "securitiesReceived" TEXT,
    "anomalous" INTEGER,
    "notAnomalous" INTEGER,
    "anomalousDate" TIMESTAMP(3),
    "checked" INTEGER,
    "checkedDate" TIMESTAMP(3),
    "budgetNo" TEXT,
    "courseDate" TIMESTAMP(3),
    "kimoFashionSoNo" TEXT,
    "orderType" INTEGER,
    "fastShipping" INTEGER,
    "commissionGroupCode" TEXT,
    "geographicalZone" TEXT,
    "sellingSeasonCode" TEXT,
    "shortcutDimension2Code" TEXT,
    "navRowversion" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "nav_pf_sales_header_pkey" PRIMARY KEY ("no_")
);

-- CreateTable
CREATE TABLE "nav_pf_sales_line" (
    "documentType" INTEGER NOT NULL,
    "documentNo" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "type" INTEGER,
    "no_" TEXT,
    "customerOrderRef" TEXT,
    "reference" TEXT,
    "genBusPostingGroup" TEXT,
    "vatBusPostingGroup" TEXT,
    "unitOfMeasure" TEXT,
    "constantVariableCode" TEXT,
    "assortmentCode" TEXT,
    "deleteReason" TEXT,
    "salesPurchaseStatusCode" TEXT,
    "salesPurchaseStatusItem" TEXT,
    "deleteDate" TIMESTAMP(3),
    "customerPriceGroup" TEXT,
    "averageUnitPrice" DOUBLE PRECISION,
    "noOfPairs" DOUBLE PRECISION,
    "quantity" DOUBLE PRECISION,
    "lineAmount" DOUBLE PRECISION,
    "invDiscountAmount" DOUBLE PRECISION,
    "quantityShipped" DOUBLE PRECISION,
    "quantityInvoiced" DOUBLE PRECISION,
    "returnQtyReceived" DOUBLE PRECISION,
    "subject1Commission" DOUBLE PRECISION,
    "subject2Commission" DOUBLE PRECISION,
    "subject3Commission" DOUBLE PRECISION,
    "subject4Commission" DOUBLE PRECISION,
    "areaManagerCommission" DOUBLE PRECISION,
    "salespersonCommission" DOUBLE PRECISION,
    "returnReasonCode" TEXT,
    "requestedDeliveryDate" TIMESTAMP(3),
    "lineDiscountPct" DOUBLE PRECISION,
    "discount1Pct" DOUBLE PRECISION,
    "discount2Pct" DOUBLE PRECISION,
    "discount3Pct" DOUBLE PRECISION,
    "locationCode" TEXT,
    "modelCrossReference" TEXT,
    "constantAssortmentVarGrp" TEXT,
    "navRowversion" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "nav_pf_sales_line_pkey" PRIMARY KEY ("documentType","documentNo","lineNo")
);

-- CreateTable
CREATE TABLE "nav_pf_sales_header_ext" (
    "documentType" INTEGER NOT NULL,
    "documentNo" TEXT NOT NULL,
    "warehouseSpecialityCode" TEXT,
    "subject3" TEXT,
    "subject4" TEXT,
    "oldOrderNo" TEXT,
    "specialRequests" TEXT,
    "navRowversion" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "nav_pf_sales_header_ext_pkey" PRIMARY KEY ("documentType","documentNo")
);

-- CreateTable
CREATE TABLE "nav_pf_item" (
    "no_" TEXT NOT NULL,
    "description" TEXT,
    "description2" TEXT,
    "configuratorRelation" INTEGER,
    "modelItemNo" TEXT,
    "variableCode01" TEXT,
    "smu" INTEGER,
    "carryOver" INTEGER,
    "futureCarryOver" INTEGER,
    "soldOut" INTEGER,
    "soldOutDate" TIMESTAMP(3),
    "salesPurchaseStatusItem" TEXT,
    "salesPurchaseStatusDate" TIMESTAMP(3),
    "potentialSoldOut" INTEGER,
    "minimumOrderQuantity" DOUBLE PRECISION,
    "mustBuy" INTEGER,
    "standardCost" DOUBLE PRECISION,
    "collectionCode" TEXT,
    "lineCode" TEXT,
    "seasonTypology" TEXT,
    "productFamily" TEXT,
    "productSex" TEXT,
    "shipmentPriority" TEXT,
    "innovationDegree" TEXT,
    "heelHeight" TEXT,
    "endCustomerPriceGap" TEXT,
    "marketSegment" TEXT,
    "productTypology" TEXT,
    "mainMaterial" TEXT,
    "soleMaterial" TEXT,
    "vendorNo" TEXT,
    "manufacturer" TEXT,
    "advertisingMaterial" TEXT,
    "countryRegionOfOriginCode" TEXT,
    "constantAssortmentVarGrp" TEXT,
    "navRowversion" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "nav_pf_item_pkey" PRIMARY KEY ("no_")
);

-- CreateTable
CREATE TABLE "nav_pf_customer" (
    "no_" TEXT NOT NULL,
    "name" TEXT,
    "name2" TEXT,
    "address" TEXT,
    "city" TEXT,
    "postCode" TEXT,
    "county" TEXT,
    "countryRegionCode" TEXT,
    "phoneNo" TEXT,
    "faxNo" TEXT,
    "eMail" TEXT,
    "businessEMail" TEXT,
    "contact" TEXT,
    "geographicalZone" TEXT,
    "geographicalZone2" TEXT,
    "keyAccount" INTEGER,
    "warehouseSpecialityCode" TEXT,
    "languageCode" TEXT,
    "fastShipment" INTEGER,
    "blockedForAssignments" INTEGER,
    "reasonBlockCode" TEXT,
    "paymentMethodCode" TEXT,
    "paymentTermsCode" TEXT,
    "vatRegistrationNo" TEXT,
    "fiscalCode" TEXT,
    "currentRisk" TEXT,
    "riskRating" TEXT,
    "pmFailureAssignedScore" TEXT,
    "updatedDate" TIMESTAMP(3),
    "updatedType" TEXT,
    "dueDate" TIMESTAMP(3),
    "internalValuation" TEXT,
    "valuationDate" TIMESTAMP(3),
    "reservationPriority" TEXT,
    "authorizedStoresNumber" INTEGER,
    "storeDistribution" INTEGER,
    "storeImage" INTEGER,
    "storeType" INTEGER,
    "variousReferences" TEXT,
    "homePage" TEXT,
    "qualityControl" TEXT,
    "oldFebosNo" TEXT,
    "oldBridgeNo" TEXT,
    "purchaseGroup" TEXT,
    "distributionChannel" TEXT,
    "creditManager" TEXT,
    "eacLabels" TEXT,
    "sovracolloCompleto" INTEGER,
    "commissionGroupCode" TEXT,
    "navRowversion" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "nav_pf_customer_pkey" PRIMARY KEY ("no_")
);

-- CreateTable
CREATE TABLE "nav_pf_ship_to_address" (
    "customerNo" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "geographicalZone2" TEXT,
    "countryRegionCode" TEXT,
    "navRowversion" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "nav_pf_ship_to_address_pkey" PRIMARY KEY ("customerNo","code")
);

-- CreateTable
CREATE TABLE "nav_pf_variable_code" (
    "variableGroup" TEXT NOT NULL,
    "variableCode" TEXT NOT NULL,
    "description" TEXT,
    "navRowversion" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "nav_pf_variable_code_pkey" PRIMARY KEY ("variableGroup","variableCode")
);

-- CreateTable
CREATE TABLE "nav_pf_salesperson" (
    "code" TEXT NOT NULL,
    "name" TEXT,
    "navRowversion" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "nav_pf_salesperson_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "nav_pf_geo_zone" (
    "code" TEXT NOT NULL,
    "description" TEXT,
    "navRowversion" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "nav_pf_geo_zone_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "nav_pf_shipment_method" (
    "code" TEXT NOT NULL,
    "description" TEXT,
    "navRowversion" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "nav_pf_shipment_method_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "nav_pf_transport_reason" (
    "code" TEXT NOT NULL,
    "description" TEXT,
    "navRowversion" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "nav_pf_transport_reason_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "nav_pf_budget_header" (
    "no_" TEXT NOT NULL,
    "budgetArea" TEXT,
    "navRowversion" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "nav_pf_budget_header_pkey" PRIMARY KEY ("no_")
);

-- CreateTable
CREATE TABLE "nav_pf_vendor" (
    "no_" TEXT NOT NULL,
    "name" TEXT,
    "navRowversion" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "nav_pf_vendor_pkey" PRIMARY KEY ("no_")
);

-- CreateTable
CREATE TABLE "nav_pf_date_prenotazione" (
    "salesDocumentNo" TEXT NOT NULL,
    "salesLineNo" INTEGER NOT NULL,
    "dateReservation" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nav_pf_date_prenotazione_pkey" PRIMARY KEY ("salesDocumentNo","salesLineNo")
);

-- CreateTable
CREATE TABLE "nav_pf_ddt_picking" (
    "orderNo" TEXT NOT NULL,
    "orderLineNo" INTEGER NOT NULL,
    "pairsTotale" DOUBLE PRECISION,
    "qtyTotale" DOUBLE PRECISION,
    "pairsRilasciate" DOUBLE PRECISION,
    "qtyRilasciate" DOUBLE PRECISION,
    "pairsAperte" DOUBLE PRECISION,
    "qtyAperte" DOUBLE PRECISION,
    "pairsDaInviareWmsps" DOUBLE PRECISION,
    "qtyDaInviareWmsps" DOUBLE PRECISION,
    "pairsInviatoWmsps" DOUBLE PRECISION,
    "qtyInviatoWmsps" DOUBLE PRECISION,
    "pairsEvasoWmsps" DOUBLE PRECISION,
    "qtyEvasoWmsps" DOUBLE PRECISION,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nav_pf_ddt_picking_pkey" PRIMARY KEY ("orderNo","orderLineNo")
);

-- CreateIndex
CREATE INDEX "nav_pf_sales_header_sellingSeasonCode_idx" ON "nav_pf_sales_header"("sellingSeasonCode");

-- CreateIndex
CREATE INDEX "nav_pf_sales_header_shortcutDimension2Code_idx" ON "nav_pf_sales_header"("shortcutDimension2Code");

-- CreateIndex
CREATE INDEX "nav_pf_sales_header_sellingSeasonCode_shortcutDimension2Cod_idx" ON "nav_pf_sales_header"("sellingSeasonCode", "shortcutDimension2Code");

-- CreateIndex
CREATE INDEX "nav_pf_sales_header_salespersonCode_idx" ON "nav_pf_sales_header"("salespersonCode");

-- CreateIndex
CREATE INDEX "nav_pf_sales_header_sellToCustomerNo_idx" ON "nav_pf_sales_header"("sellToCustomerNo");

-- CreateIndex
CREATE INDEX "nav_pf_sales_line_documentNo_idx" ON "nav_pf_sales_line"("documentNo");

-- CreateIndex
CREATE INDEX "nav_pf_sales_line_no__idx" ON "nav_pf_sales_line"("no_");

-- CreateIndex
CREATE INDEX "nav_pf_sales_line_constantVariableCode_idx" ON "nav_pf_sales_line"("constantVariableCode");

-- CreateIndex
CREATE INDEX "nav_pf_item_modelItemNo_idx" ON "nav_pf_item"("modelItemNo");

-- CreateIndex
CREATE INDEX "nav_pf_item_configuratorRelation_idx" ON "nav_pf_item"("configuratorRelation");

-- CreateIndex
CREATE INDEX "nav_pf_item_modelItemNo_variableCode01_idx" ON "nav_pf_item"("modelItemNo", "variableCode01");

-- CreateIndex
CREATE INDEX "nav_pf_ship_to_address_customerNo_idx" ON "nav_pf_ship_to_address"("customerNo");

-- CreateIndex
CREATE INDEX "nav_pf_ddt_picking_orderNo_idx" ON "nav_pf_ddt_picking"("orderNo");
