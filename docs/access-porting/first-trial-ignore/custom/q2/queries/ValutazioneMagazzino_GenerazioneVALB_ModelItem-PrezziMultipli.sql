SELECT [Purch_ Price Model Item].[Model Item No_], Count([Purch_ Price Model Item].[Model Item No_]) AS [ConteggioDiModel Item No_], [Purch_ Price Model Item].[Constant Variable Code], [Purch_ Price Model Item].[Variable Code 01], [Purch_ Price Model Item].[Variable Code 02]
FROM [Purch_ Price Model Item]
GROUP BY [Purch_ Price Model Item].[Model Item No_], [Purch_ Price Model Item].[Constant Variable Code], [Purch_ Price Model Item].[Variable Code 01], [Purch_ Price Model Item].[Variable Code 02]
HAVING (((Count([Purch_ Price Model Item].[Model Item No_]))>1));

