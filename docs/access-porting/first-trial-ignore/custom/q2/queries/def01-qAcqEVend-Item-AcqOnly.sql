SELECT "ACQ" AS Cat, qAcqItemGrouped.*
FROM qAcqItemGrouped LEFT JOIN qVendItemGrouped ON (qAcqItemGrouped.AssortmentCode = qVendItemGrouped.AssortmentCode) AND (qAcqItemGrouped.No_ = qVendItemGrouped.No_)
WHERE (((qVendItemGrouped.No_) Is Null));

