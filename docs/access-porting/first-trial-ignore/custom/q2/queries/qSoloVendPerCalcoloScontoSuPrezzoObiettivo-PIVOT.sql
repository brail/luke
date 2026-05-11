SELECT Sum(qSoloVendPerCalcoloScontoSuPrezzoObiettivo.SalesTargetValue) AS SalesTargetValueTotal, Sum(qSoloVendPerCalcoloScontoSuPrezzoObiettivo.SalesValue) AS SalesValueTotal, Sum([SalesTargetValue]-[SalesValue]) AS diff, [Item].[Season Code], [Item].[Trademark Code], [Item].[Line Code], [Customer].Name, [Customer].[Geographical Zone]
FROM (qSoloVendPerCalcoloScontoSuPrezzoObiettivo INNER JOIN Item ON qSoloVendPerCalcoloScontoSuPrezzoObiettivo.No_ = [Item].No_) INNER JOIN Customer ON qSoloVendPerCalcoloScontoSuPrezzoObiettivo.[Sell-to Customer No_] = [Customer].No_
GROUP BY [Item].[Season Code], [Item].[Trademark Code], [Item].[Line Code], [Customer].Name, [Customer].[Geographical Zone];

