SELECT [BudgetVend-Union].*, [Customer].[Geographical Zone], [Geographical Zone].Description AS GeographicalZoneDescription
FROM ([BudgetVend-Union] LEFT JOIN Customer ON [BudgetVend-Union].CustomerCode = [Customer].No_) LEFT JOIN [Geographical Zone] ON [Customer].[Geographical Zone] = [Geographical Zone].[Geographical Zone];

