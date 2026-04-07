SELECT [Originale IC Trade].*, Item.[Variable Code 02] AS [Size]
FROM [Originale IC Trade] LEFT JOIN Item ON ([Originale IC Trade].ColorCode = Item.[Variable Code 01]) AND ([Originale IC Trade].[Article Code] = Item.[Model Item No_]);

