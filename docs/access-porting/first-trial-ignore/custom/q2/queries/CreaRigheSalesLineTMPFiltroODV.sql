INSERT INTO SalesLineTMP ( [Document NO_], [Line NO_], [Customer NO_], NO_, qty, [Customer Name] )
SELECT [Sales Line].[Document No_], [Sales Line].[Line No_], [Sales Line].[Sell-to Customer No_], [Sales Line].No_, Val([quantity]) AS Espr1, [Sales Header].[Sell-to Customer Name]
FROM [Sales Line] INNER JOIN [Sales Header] ON ([Sales Header].No_ = [Sales Line].[Document No_]) AND ([Sales Line].[Document Type] = [Sales Header].[Document Type])
WHERE ((([Sales Line].[Document No_])=[Forms]![Principale]![FiltroODVEan]) AND (([Sales Line].[Delete Reason])=''));

