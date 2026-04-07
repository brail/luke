SELECT Item.[trademark code], Item.[season code], [Cross-Reference Model Item].[Cross-Reference Type No_], Customer.Name
FROM ([Cross-Reference Model Item] INNER JOIN Item ON [Cross-Reference Model Item].[Model Item No_] = Item.No_) INNER JOIN Customer ON [Cross-Reference Model Item].[Cross-Reference Type No_] = Customer.No_
WHERE ((([Cross-Reference Model Item].[Cross-Reference No_])<>""))
GROUP BY Item.[trademark code], Item.[season code], [Cross-Reference Model Item].[Cross-Reference Type No_], Customer.Name
HAVING (((Item.[season code])=[forms]![principale]![FiltroStagioneEAN]))
ORDER BY Item.[trademark code], Item.[season code], Customer.Name;

