INSERT INTO SalesLineTMP ( [Document NO_], [Line NO_], [Customer NO_], NO_, qty, [Customer Name] )
SELECT [Purchase Line].[Document No_], [Purchase Line].[Line No_], [Purchase Header].[Buy-from Vendor No_], [Purchase Line].No_, Val([quantity]) AS Espr1, [Purchase Header].[Pay-to Name]
FROM [Purchase Header] INNER JOIN [Purchase Line] ON ([Purchase Header].No_ = [Purchase Line].[Document No_]) AND ([Purchase Header].[Document Type] = [Purchase Line].[Document Type])
WHERE ((([Purchase Line].[Document No_])=[Forms]![Principale]![FiltroODAEan]) AND (([Purchase Line].[Delete Reason])=''));

