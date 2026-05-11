SELECT [Geographical Zone].[Commercial Manager], Customer.[commercial Manager], Customer.[Geographical Zone], [Geographical Zone].Description
FROM [Geographical Zone] INNER JOIN Customer ON [Geographical Zone].Code = Customer.[Geographical Zone]
WHERE ((([Geographical Zone].[Commercial Manager])<>[customer.commercial manager]));

