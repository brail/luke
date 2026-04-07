SELECT [Sales Invoice Line].[Line No_], [Sales Invoice Line].No_, [Sales Invoice Line].[Constant Variable Code], [Sales Invoice Line].[Original Line No_], [Sales Invoice Line].[Model Item No_], [Sales Invoice Line].[Variable Code 01], [Sales Invoice Line].*, [Sales Invoice Line].[Document No_], Val([QUANTITY]) AS QTY, Val([NO_ OF PAIRS]) AS PAIRS
FROM [Sales Invoice Line]
WHERE ((([Sales Invoice Line].[Document No_])="FVE-24-01680"));

