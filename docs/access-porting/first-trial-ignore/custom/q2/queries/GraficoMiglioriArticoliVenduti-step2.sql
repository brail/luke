SELECT [GraficoMiglioriArticoliVenduti-step0].Articolo, Sum([GraficoMiglioriArticoliVenduti-step0].PaiaConfermate) AS PaiaPerArticolo
FROM [GraficoMiglioriArticoliVenduti-step0]
GROUP BY [GraficoMiglioriArticoliVenduti-step0].Articolo;

