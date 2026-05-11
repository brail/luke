SELECT WMS_Gorbes__05_RicercaViolazioniBinContent_step1.[Location Code], WMS_Gorbes__05_RicercaViolazioniBinContent_step1.[bin code], WMS_Gorbes__05_RicercaViolazioniBinContent_step1.[iTEM NO_], [Bin Content].[Location Code], [Bin Content].[Bin Code], [Bin Content].[Item No_]
FROM WMS_Gorbes__05_RicercaViolazioniBinContent_step1 INNER JOIN [Bin Content] ON ([Bin Content].[Location Code] = WMS_Gorbes__05_RicercaViolazioniBinContent_step1.[Location Code]) AND (WMS_Gorbes__05_RicercaViolazioniBinContent_step1.[iTEM NO_] = [Bin Content].[Item No_]);

