SELECT qSoloVend.[Salesperson Code] AS SalesPersonCode, qSoloVend.Salesperson, qSoloVend.[Sell-to Customer No_] AS CustomerCode, [Customer].Name AS CustomerName, [Item].[Trademark Code] AS Trademark, [Item].[Season Code] AS SeasonCode, Sum((Val([No_ of Pairs]))) AS PairsSold, Sum(qSoloVend.SalesValue) AS salesvalue
FROM (qSoloVend INNER JOIN Customer ON qSoloVend.[Sell-to Customer No_] = [Customer].No_) INNER JOIN Item ON qSoloVend.No_ = [Item].No_
WHERE (((qSoloVend.[Delete Reason])=""))
GROUP BY qSoloVend.[Salesperson Code], qSoloVend.Salesperson, qSoloVend.[Sell-to Customer No_], [Customer].Name, [Item].[Trademark Code], [Item].[Season Code];

