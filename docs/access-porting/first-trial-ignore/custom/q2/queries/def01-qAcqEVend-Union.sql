SELECT [PurchasesArt] as Article,[PurchasesColorCode] as ColorCode, PurchasesAssortment as Assortment, QuantityPurchased, PairsPurchased, ValuePurchased, ValuePurchasedEur, QuantityReceived, PairsReceived, ValueReceived, QuantityInvoicedPurchases, PairsInvoicedPurchases, ValueInvoicedPurchases, CurrencyCodePurchase, QuantitySold,PairsSold,ValueSold, QuantityShipped, PairsShipped, ValueShipped, QuantityInvoiced, PairsInvoiced, ValueInvoiced, grosssalesvalue, discountvalue, areamanagercommissionvalue, salespersoncommissionvalue
FROM [def01-qAcqEVend-Both]

union all SELECT [PurchasesArt], [PurchasesColorCode], PurchasesAssortment as Assortment, QuantityPurchased, PairsPurchased, ValuePurchased, ValuePurchasedEur, QuantityReceived, PairsReceived, ValueReceived, QuantityInvoicedPurchases, PairsInvoicedPurchases, ValueInvoicedPurchases, CurrencyCodePurchase, 0,0,0,0,0,0,0,0,0,0,0,0,0
FROM [def01-qAcqEVend-AcqOnly];

UNION ALL SELECT [SalesArt], [SalesColorCode], [SalesAssortment], 0, 0, 0,0,0,0,0,0,0,0, "", QuantitySold, PairsSold, ValueSold, QuantityShipped, PairsShipped, ValueShipped, QuantityInvoiced, PairsInvoiced, ValueInvoiced, grosssalesvalue, discountvalue, areamanagercommissionvalue, salespersoncommissionvalue
FROM [def01-qAcqEVend-VendOnly];

