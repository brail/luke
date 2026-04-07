SELECT Item.[Model Item No_], Item.[Variable Code 01], Item.Smu, Item.[Carry Over], Item.[Future Carry Over], Item.[Sold Out], Item.[Sold Out Date], Item.[Sales_Purchase Status - Item], Item.[Sales_Purchase Status Date], Item.[Potential Sold Out], Val([Minimum Order Quantity]) AS MOQ
FROM Item
WHERE (((Item.[Configurator Relation])=3))
GROUP BY Item.[Model Item No_], Item.[Variable Code 01], Item.Smu, Item.[Carry Over], Item.[Future Carry Over], Item.[Sold Out], Item.[Sold Out Date], Item.[Sales_Purchase Status - Item], Item.[Sales_Purchase Status Date], Item.[Potential Sold Out], Val([Minimum Order Quantity])
ORDER BY Item.[Model Item No_];

