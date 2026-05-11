SELECT [Customer].No_ AS NoCliente, [Customer].Name, [Customer].[Name 2], [Customer].Address, [Customer].City, [Customer].[Post Code] AS PostCode, [Customer].County, [Customer].[Country Code] AS CountryCode, [Customer].[Fiscal Code] AS FiscalCode, [Customer].[VAT Registration No_] AS VATRegistrationNo, Sum([def01-ANALISIVENDUTO-PIVOT].salesvalue) AS ValoreVenditaNetto
FROM [def01-ANALISIVENDUTO-PIVOT] INNER JOIN Customer ON [def01-ANALISIVENDUTO-PIVOT].CustomerCode = [Customer].No_
WHERE ((([def01-ANALISIVENDUTO-PIVOT].[Season Code])=[stagione]) AND (([def01-ANALISIVENDUTO-PIVOT].[Delete Reason])="") AND (([def01-ANALISIVENDUTO-PIVOT].DocumentType)="sales"))
GROUP BY [Customer].No_, [Customer].Name, [Customer].[Name 2], [Customer].Address, [Customer].City, [Customer].[Post Code], [Customer].County, [Customer].[Country Code], [Customer].[Fiscal Code], [Customer].[VAT Registration No_];

