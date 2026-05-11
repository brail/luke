SELECT Cat, [PurchasesArt] as Article, [PurchasesColorCode] as ColorCode,  [AssortmentCode], quantitypurchased, pairspurchased, CurrencyCodePurchase, valuepurchased, quantityreceived, pairsreceived, ValueReceived, quantityinvoicedPurchases, pairsinvoicedPurchases, valueinvoicedPurchases, QuantitySold,PairsSold, ValueSold, QuantityShipped, PairsShipped, ValueShipped, QuantityInvoiced, PairsInvoiced, ValueInvoiced, grosssalesvalue, discountvalue, areamanagercommissionvalue, salespersoncommissionvalue, taglia, [order variable code]
FROM [def01-qAcqEVend-Item-Both]


union all SELECT Cat, [PurchasesArt], [PurchasesColorCode],   [AssortmentCode],quantitypurchased, pairspurchased, CurrencyCodePurchase, valuepurchased, quantityreceived, pairsreceived, ValueReceived, quantityinvoicedPurchases, pairsinvoicedPurchases, valueinvoicedPurchases, 0,0,0,0,0,0,0,0,0,0, 0,0,0, taglia, [order variable code]
FROM [def01-qAcqEVend-Item-AcqOnly];


UNION ALL SELECT Cat, [SalesArt], [SalesColorCode],  [AssortmentCode], 0, 0,"", 0,  0,0,0, 0,0,0, QuantitySold,PairsSold, ValueSold, QuantityShipped, PairsShipped, ValueShipped, QuantityInvoiced, PairsInvoiced, ValueInvoiced, grosssalesvalue, discountvalue, areamanagercommissionvalue, salespersoncommissionvalue, taglia, [order variable code]
FROM [def01-qAcqEVend-Item-VendOnly];

