INSERT INTO VendutoComprato_FattoriDiPropiezione ( BudgetNo_, BudgetDescrizione, SeasonCode, TrademarkCode, BudgetType )
SELECT [Budget Header].No_, [Budget Header].Description, [Budget Header].[Selling Season Code], [Budget Header].[Trademark Code], [Budget Header].[Budget Type]
FROM [Budget Header];

