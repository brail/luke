INSERT INTO SalesLineTMP ( [Document NO_], [Line NO_], [Customer NO_], NO_, qty, [Customer Name] )
SELECT [Sales Line].[Document No_], [Sales Line].[Line No_], [Sales Line].[Sell-to Customer No_], [Sales Line].No_, Val([quantity]) AS Espr1, [Sales Header].[Sell-to Customer Name]
FROM ([Sales Line] INNER JOIN Item ON [Sales Line].No_ = Item.No_) INNER JOIN [Sales Header] ON ([Sales Header].[Document Type] = [Sales Line].[Document Type]) AND ([Sales Line].[Document No_] = [Sales Header].No_)
WHERE ((([Sales Line].[Sell-to Customer No_])=[Forms]![Principale]![FiltroClienteEan]) AND (([Sales Line].[Delete Reason])='') AND ((Item.[Season Code])=[Forms]![Principale]![FiltroStagioneEan2]));

