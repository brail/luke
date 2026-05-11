UPDATE PesiDiDefault RIGHT JOIN Item ON (PesiDiDefault.productFamily = Item.[Product Family]) AND (PesiDiDefault.productSex = Item.[Product Sex]) SET Item.[Gross Weight] = [GrossWeight]
WHERE (((Item.No_) Not Like 'TEMP%') AND ((Item.[Season Code])=[stagionedifiltro]) AND ((Item.[trademark code])=[marchiodifiltro]));

