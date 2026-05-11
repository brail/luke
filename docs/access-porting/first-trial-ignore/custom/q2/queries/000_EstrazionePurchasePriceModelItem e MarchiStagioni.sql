SELECT [Purch_ Price Model Item].*, Item.[Trademark Code], Item.[Season Code]
FROM [Purch_ Price Model Item] INNER JOIN Item ON [Purch_ Price Model Item].[Model Item No_] = Item.No_;

