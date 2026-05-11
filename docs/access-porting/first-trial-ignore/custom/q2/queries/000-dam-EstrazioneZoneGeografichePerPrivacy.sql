SELECT Customer.No_, Customer.Name, Customer.[Business E-Mail], [Geographical Zone].Description AS Geo1Desc, [Geographical Zone_1].Description AS Geo2Desc
FROM (Customer LEFT JOIN [Geographical Zone] ON Customer.[Geographical Zone] = [Geographical Zone].Code) LEFT JOIN [Geographical Zone] AS [Geographical Zone_1] ON Customer.[Geographical Zone 2] = [Geographical Zone_1].Code;

