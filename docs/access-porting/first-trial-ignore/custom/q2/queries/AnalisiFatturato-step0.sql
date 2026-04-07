SELECT Customer.No_, Customer.Name, Customer.[Credit Limit (LCY)], Customer.[Name 2], [Sales Invoice Line].*, [Sales Invoice Header].[Document Date], [Sales Invoice Header].No_, [Sales Invoice Header].[Currency Code], Item.[Trademark Code], Item.[Season Code]
FROM ([Sales Invoice Line] INNER JOIN ([Sales Invoice Header] INNER JOIN Customer ON [Sales Invoice Header].[Sell-to Customer No_] = Customer.No_) ON [Sales Invoice Line].[Document No_] = [Sales Invoice Header].No_) INNER JOIN Item ON [Sales Invoice Line].No_ = Item.No_;

