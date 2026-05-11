SELECT [Item Identifier].Code, Item.[Trademark Code], [Item Identifier].[Brand Code], [Item Identifier].[Season Code], [Item Identifier].[Collection Code], [Item Identifier].[Line Code], [Item Identifier].[Model Code], [Item Identifier].[Item No_], [Item Identifier].[Constant Variable Code], [Item Identifier].[Assortment Code], [Item Identifier].Status, [Item Identifier].[Last Location Code Used], [Item Identifier].[Last Bin Code Used]
FROM [Item Identifier] INNER JOIN Item ON [Item Identifier].[Item No_] = Item.No_
WHERE ((([Item Identifier].[Item No_])="F5CPH570/VIT") AND (([Item Identifier].[Constant Variable Code])="BLK") AND (([Item Identifier].[Assortment Code])="CPH01" Or ([Item Identifier].[Assortment Code])="CPH02"));

