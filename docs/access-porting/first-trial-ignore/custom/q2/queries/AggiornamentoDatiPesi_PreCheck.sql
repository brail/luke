SELECT Item.[Gross Weight], Item.No_, Item.[Season Code], Item.[trademark code], Item.[Product Sex], Item.[Product Family], PesiDiDefault.productSex
FROM PesiDiDefault RIGHT JOIN Item ON (PesiDiDefault.productFamily = Item.[Product Family]) AND (PesiDiDefault.productSex = Item.[Product Sex])
WHERE (((Item.No_) Not Like 'TEMP%') AND ((Item.[Season Code])=[forms]![principale]![filtrostagionepesididefault]) AND ((Item.[trademark code])=[forms]![principale]![filtromarchiopesididefault]) AND ((PesiDiDefault.productSex) Is Null));

