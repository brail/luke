SELECT QC_1.PackageNr, QC_1.[Document No_], QC_1.[Item No_], QC_1.[Colour Code], QC_1.TrademarkCode, QC_1.[Selling Season Code], QC_1.BoxQty, QC_2.TotQty
FROM (QC_1 INNER JOIN QC_2 ON (QC_1.[Colour Code] = QC_2.[Constant Variable Code]) AND (QC_1.[Item No_] = QC_2.No_) AND (QC_1.[Document No_] = QC_2.[Document No_])) INNER JOIN QC_3 ON QC_2.[Document No_] = QC_3.[Document No_]
ORDER BY QC_1.[Document No_], QC_1.PackageNr;

