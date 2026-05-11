SELECT Item.[Trademark Code], Item.[season code], Item.[product sex] AS Gender, Item.[line code], [Cross-Reference Model Item].[Model Item No_], [Cross-Reference Model Item].[Constant Variable Code] AS Color, Item.[Description 2], [Cross-Reference Model Item].[Cross-Reference Type No_] AS [Customer Code], Customer.Name, [Cross-Reference Model Item].[Cross-Reference No_]
FROM ([Cross-Reference Model Item] INNER JOIN Item ON [Cross-Reference Model Item].[Model Item No_] = Item.No_) INNER JOIN Customer ON [Cross-Reference Model Item].[Cross-Reference Type No_] = Customer.No_
WHERE (((Item.[season code])=[forms]![principale]![FiltroStagioneEAN]) AND (([Cross-Reference Model Item].[Cross-Reference No_])<>""))
ORDER BY Item.[Trademark Code], Item.[product sex], Item.[line code], [Cross-Reference Model Item].[Model Item No_], Customer.Name;

