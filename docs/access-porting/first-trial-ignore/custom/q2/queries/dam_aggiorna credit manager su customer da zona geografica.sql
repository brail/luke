SELECT [Geographical Zone].[Credit Manager], Customer.[Credit Manager], Customer.[Geographical Zone], [Geographical Zone].Description, Customer.Name
FROM [Geographical Zone] INNER JOIN Customer ON [Geographical Zone].Code = Customer.[Geographical Zone]
WHERE ((([Geographical Zone].[Credit Manager])<>[customer.credit manager]));

