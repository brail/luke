SELECT qVendGrouped.*, qAcqGrouped.PurchasesArt
FROM qAcqGrouped RIGHT JOIN qVendGrouped ON (qAcqGrouped.PurchasesArt = qVendGrouped.SalesArt) AND (qAcqGrouped.PurchasesColorCode = qVendGrouped.SalesColorCode) AND (qAcqGrouped.PurchasesAssortment = qVendGrouped.SalesAssortment)
WHERE (((qAcqGrouped.PurchasesArt) Is Null));

