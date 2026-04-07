INSERT INTO SalesLineTMP ( [Document NO_], [Line NO_], [Customer NO_], NO_, qty, [Customer Name] )
SELECT [Sales Invoice Line].[Document No_], [Sales Invoice Line].[Line No_], [Sales Invoice Line].[Sell-to Customer No_], [Sales Invoice Line].No_, Val([quantity]) AS Espr1, [Sales Invoice Header].[Sell-to Customer Name]
FROM [Sales Invoice Header] INNER JOIN [Sales Invoice Line] ON [Sales Invoice Header].No_ = [Sales Invoice Line].[Document No_]
WHERE ((([Sales Invoice Line].[Document No_])=[Forms]![Principale]![FiltroEanFatt]) AND (([Sales Invoice Line].[Delete Reason])=''));

