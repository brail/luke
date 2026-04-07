SELECT WMS_UltimaCollocazione_Step3_Union.Code, Max(WMS_UltimaCollocazione_Step3_Union.[Entry No_]) AS [MaxDiEntry No_]
FROM WMS_UltimaCollocazione_Step3_Union
GROUP BY WMS_UltimaCollocazione_Step3_Union.Code;

