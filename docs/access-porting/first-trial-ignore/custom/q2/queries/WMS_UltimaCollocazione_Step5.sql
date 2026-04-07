SELECT WMS_UltimaCollocazione_Step3_Union.*
FROM WMS_UltimaCollocazione_Step4_LastEntry INNER JOIN WMS_UltimaCollocazione_Step3_Union ON (WMS_UltimaCollocazione_Step4_LastEntry.[MaxDiEntry No_] = WMS_UltimaCollocazione_Step3_Union.[Entry No_]) AND (WMS_UltimaCollocazione_Step4_LastEntry.Code = WMS_UltimaCollocazione_Step3_Union.Code);

