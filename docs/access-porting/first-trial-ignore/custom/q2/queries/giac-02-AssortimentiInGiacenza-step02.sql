SELECT [giac-02-AssortimentiInGiacenza-step01].[Model Item No_], [giac-02-AssortimentiInGiacenza-step01].[Constant Variable Code], [giac-02-AssortimentiInGiacenza-step01].[Assortment Code], Sum(Val([Quantity])) AS AssortimentiInGiacenza, [giac-02-AssortimentiInGiacenza-step01].[Constant Assortment Var_Grp_], [giac-02-AssortimentiInGiacenza-step01].[Assortment Variable Group]
FROM [giac-02-AssortimentiInGiacenza-step01]
GROUP BY [giac-02-AssortimentiInGiacenza-step01].[Model Item No_], [giac-02-AssortimentiInGiacenza-step01].[Constant Variable Code], [giac-02-AssortimentiInGiacenza-step01].[Assortment Code], [giac-02-AssortimentiInGiacenza-step01].[Constant Assortment Var_Grp_], [giac-02-AssortimentiInGiacenza-step01].[Assortment Variable Group]
HAVING (((Sum(Val([Quantity])))>0));

