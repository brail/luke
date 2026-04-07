SELECT [GraficoMiglioriArticoliVenduti-step0].VendorName, [GraficoMiglioriArticoliVenduti-step0].Linea, Sum([GraficoMiglioriArticoliVenduti-step0].PaiaConfermate) AS PaiaPerLinea
FROM [GraficoMiglioriArticoliVenduti-step0]
GROUP BY [GraficoMiglioriArticoliVenduti-step0].VendorName, [GraficoMiglioriArticoliVenduti-step0].Linea;

