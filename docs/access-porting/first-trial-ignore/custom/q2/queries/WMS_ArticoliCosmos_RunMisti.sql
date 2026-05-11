SELECT WMS_ArticoliCosmos_RunMisti_step2.[Bill-to Customer No_], WMS_ArticoliCosmos_RunMisti_step2.[Bill-to Name], WMS_ArticoliCosmos_RunMisti_step2.[Document No_], WMS_ArticoliCosmos_RunMisti_step2.[Item No_], WMS_ArticoliCosmos_RunMisti_step2.[Constant Variable Code], WMS_ArticoliCosmos_RunMisti_step2.qualityLevel, Sum(WMS_ArticoliCosmos_RunMisti_step2.qty) AS paia
FROM WMS_ArticoliCosmos_RunMisti_step2
GROUP BY WMS_ArticoliCosmos_RunMisti_step2.[Bill-to Customer No_], WMS_ArticoliCosmos_RunMisti_step2.[Bill-to Name], WMS_ArticoliCosmos_RunMisti_step2.[Document No_], WMS_ArticoliCosmos_RunMisti_step2.[Item No_], WMS_ArticoliCosmos_RunMisti_step2.[Constant Variable Code], WMS_ArticoliCosmos_RunMisti_step2.qualityLevel;

