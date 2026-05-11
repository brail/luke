SELECT qAcqGrouped.*, qVendGrouped.SalesArt
FROM qAcqGrouped LEFT JOIN qVendGrouped ON (qAcqGrouped.PurchasesAssortment = qVendGrouped.SalesAssortment) AND (qAcqGrouped.PurchasesColorCode = qVendGrouped.SalesColorCode) AND (qAcqGrouped.PurchasesArt = qVendGrouped.SalesArt)
WHERE (((qVendGrouped.SalesArt) Is Null));

