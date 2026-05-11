SELECT QC_1.PackageNr AS febos_box_id, QC_1.[Document No_] AS febos_po_id, QC_1.[Item No_] AS febos_article_id, QC_1.[Description 2] AS febos_article_name, QC_1.[Colour Code] AS febos_color_code, QC_1.febos_color_desc, QC_1.[Assortment Code] AS febos_assortment, QC_1.BoxQty AS febos_assortment_no, QC_1.febos_box_no, QC_3.febos_box_all
FROM (QC_1 INNER JOIN QC_2 ON (QC_1.[Colour Code] = QC_2.[Constant Variable Code]) AND (QC_1.[Item No_] = QC_2.No_) AND (QC_1.[Document No_] = QC_2.[Document No_])) INNER JOIN QC_3 ON QC_2.[Document No_] = QC_3.[Document No_]
ORDER BY QC_1.[Document No_], QC_1.febos_box_no;

