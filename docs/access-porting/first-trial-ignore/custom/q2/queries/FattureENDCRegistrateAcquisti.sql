SELECT "FATT" AS tipo, [FattureENDCRegistrateAcquisti-step0].Amount_, [currency code], [FattureENDCRegistrateAcquisti-step0].[Buy-from Vendor No_], [FattureENDCRegistrateAcquisti-step0].[pay-to name], [FattureENDCRegistrateAcquisti-step0].[Shortcut Dimension 2 Code], [FattureENDCRegistrateAcquisti-step0].InvoiceNo, [FattureENDCRegistrateAcquisti-step0].DataFattura
FROM [FattureENDCRegistrateAcquisti-step0];

UNION ALL SELECT "NDC" AS tipo, -[FattureENDCRegistrateAcquisti-step1].Amount_, [currency code], [FattureENDCRegistrateAcquisti-step1].[Buy-from Vendor No_], [FattureENDCRegistrateAcquisti-step1].[name], [FattureENDCRegistrateAcquisti-step1].[Shortcut Dimension 2 Code], [FattureENDCRegistrateAcquisti-step1].InvoiceNo, [FattureENDCRegistrateAcquisti-step1].DataFattura
FROM [FattureENDCRegistrateAcquisti-step1];

