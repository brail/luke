SELECT WeLineType, [Item No_], [Constant Variable Code], [Assortment Code], TestataWE, RigaWE, Code, [Entry No_], [Location Code],  [Bin Code]
FROM WMS_UltimaCollocazione_Step1_Journal;


UNION ALL SELECT WeLineType, [Item No_], [Constant Variable Code], [Assortment Code], TestataWE, RigaWE, Code, [Entry No_], [Location Code], [Bin Code]
FROM WMS_UltimaCollocazione_Step2_Docs;

