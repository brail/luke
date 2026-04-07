SELECT Count([No_]) AS ConteggioSPD, WMS_AnalisiStatusDDT_Detail.Status, WMS_AnalisiStatusDDT_Detail.StatusWHSE, Sum(WMS_AnalisiStatusDDT_Detail.qty) AS SommaDiqty
FROM WMS_AnalisiStatusDDT_Detail
GROUP BY WMS_AnalisiStatusDDT_Detail.Status, WMS_AnalisiStatusDDT_Detail.StatusWHSE
HAVING (((WMS_AnalisiStatusDDT_Detail.Status)=0 Or (WMS_AnalisiStatusDDT_Detail.Status)=1));

