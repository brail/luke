SELECT "VEN" AS Cat, qVendItemGrouped.*
FROM qAcqItemGrouped RIGHT JOIN qVendItemGrouped ON (qAcqItemGrouped.assortmentcode = qVendItemGrouped.assortmentcode) AND (qAcqItemGrouped.No_ = qVendItemGrouped.No_)
WHERE (((qAcqItemGrouped.No_) Is Null));

