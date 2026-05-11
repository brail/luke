SELECT [Sales Invoice Header].NSP_Subject1, [Sales Invoice Header].NSP_Subject2, [Sales Invoice Line].[Document No_], Item.[Season Code], Item.[Trademark Code]
FROM ([Sales Invoice Line] INNER JOIN [Sales Invoice Header] ON [Sales Invoice Line].[Document No_] = [Sales Invoice Header].No_) INNER JOIN Item ON [Sales Invoice Line].No_ = Item.No_
GROUP BY [Sales Invoice Header].NSP_Subject1, [Sales Invoice Header].NSP_Subject2, [Sales Invoice Line].[Document No_], Item.[Season Code], Item.[Trademark Code]
HAVING (((Item.[Season Code])=[forms]![principale]![filtroStagioneareaamministrativa]) AND ((Item.[Trademark Code])=[forms]![principale]![filtromarchiotempipagamento]));

