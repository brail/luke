SELECT qAcq.No_, qAcq.[Constant Variable Code], Val([No_ of Pairs]) AS TotalPairs, Val([Quantity]) AS TotalQuantity, qAcq.[Assortment Code], qAcq.ReceivedValue, qAcq.ReceivedPairs, qAcq.[Document No_], qAcq.[Delete Reason], qAcq.PurchaseValue
FROM qAcq
WHERE (((qAcq.[Document No_])="ODA-11-00001"));

