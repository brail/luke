SELECT qAcq.No_ AS PurchasesArt, qAcq.[Constant Variable Code] AS PurchasesColorCode, qAcq.[Assortment Code] AS PurchasesAssortment, Sum(qAcq.QuantityPurchased) AS QuantityPurchased, Sum(qAcq.PairsPurchased) AS PairsPurchased, qAcq.[Currency Code] AS CurrencyCodePurchase, Sum(qAcq.ValuePurchased) AS ValuePurchased, Sum(qAcq.ValuePurchasedEur) AS ValuePurchasedEur, Sum(qAcq.QuantityReceived) AS QuantityReceived, Sum(qAcq.PairsReceived) AS PairsReceived, Sum(qAcq.ValueReceived) AS ValueReceived, Sum(qAcq.QuantityInvoicedPurchases) AS QuantityInvoicedPurchases, Sum(qAcq.PairsInvoicedPurchases) AS PairsInvoicedPurchases, Sum(qAcq.ValueInvoicedPurchases) AS ValueInvoicedPurchases
FROM qAcq
GROUP BY qAcq.No_, qAcq.[Constant Variable Code], qAcq.[Assortment Code], qAcq.[Currency Code];

