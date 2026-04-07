UPDATE ([Purch_ Price Model Item] INNER JOIN Item ON [Purch_ Price Model Item].[Model Item No_] = Item.No_) INNER JOIN Vendor ON [Purch_ Price Model Item].[Vendor No_] = Vendor.No_ SET [Purch_ Price Model Item].[Currency Code] = "USD"
WHERE ((([Purch_ Price Model Item].[Vendor No_])="F01022") AND ((Item.[trademark code])="BLK"));

