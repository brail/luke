SELECT Customer.Name, [Sales Line].[Document Type], [Sales Line].[Document No_], Item.[Season Code], Item.[Trademark Code], [Sales Line].[Line Discount _], Sum(IIf([Sales Line.document type]=1,(Val([Line Amount])-Val([Inv_ Discount Amount])),-(Val([Line Amount])-Val([Inv_ Discount Amount])))) AS ValueSold, Sum(IIf([Sales Line.document type]=1,Val([No_ of pairs]),-Val([No_ of pairs]))) AS PairsSold, First((Val([Area Manager Commission _]))) AS AreaManagerCommission, First((Val([Salesperson Commission _]))) AS SalesPersonCommission
FROM ([Sales Line] INNER JOIN Item ON [Sales Line].No_ = Item.No_) INNER JOIN Customer ON [Sales Line].[Sell-to Customer No_] = Customer.No_
WHERE ((([Sales Line].[delete reason])=""))
GROUP BY Customer.Name, [Sales Line].[Document Type], [Sales Line].[Document No_], Item.[Season Code], Item.[Trademark Code], [Sales Line].[Line Discount _], [Sales Line].Type
HAVING ((([Sales Line].[Document Type])=1) AND (([Sales Line].Type)=19 Or ([Sales Line].Type)=20))
ORDER BY [Sales Line].[Document No_];

