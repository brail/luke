SELECT [giac-01-AssortimentiInBolla-step01].No_, [giac-01-AssortimentiInBolla-step01].[Constant Variable Code], [giac-01-AssortimentiInBolla-step01].[Assortment Code], Sum(Val([Quantity])) AS AssortimentiInBolla, [giac-01-AssortimentiInBolla-step01].[Constant Assortment Var_Grp_], [giac-01-AssortimentiInBolla-step01].[Assortment Variable Group]
FROM [giac-01-AssortimentiInBolla-step01]
GROUP BY [giac-01-AssortimentiInBolla-step01].No_, [giac-01-AssortimentiInBolla-step01].[Constant Variable Code], [giac-01-AssortimentiInBolla-step01].[Assortment Code], [giac-01-AssortimentiInBolla-step01].[Constant Assortment Var_Grp_], [giac-01-AssortimentiInBolla-step01].[Assortment Variable Group];

