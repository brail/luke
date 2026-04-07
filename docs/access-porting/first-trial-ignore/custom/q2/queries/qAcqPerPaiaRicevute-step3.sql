SELECT [qAcqPerPaiaRicevute-step1].*, [Item].[Trademark Code], [Item].[Season Code], [Item].[Line Code], [Vendor].Name AS Vendor
FROM ([qAcqPerPaiaRicevute-step1] INNER JOIN Item ON [qAcqPerPaiaRicevute-step1].PurchasesArt = [Item].No_) INNER JOIN Vendor ON [Item].[Vendor No_] = [Vendor].No_;

