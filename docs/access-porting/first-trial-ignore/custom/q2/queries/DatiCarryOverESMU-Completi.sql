SELECT Item.[Season Code], Item.[Trademark Code], Item.[Collection Code], Item.[Product Sex], Item.[Model Item No_], Item.[Variable Group 01], Item.[Variable Code 01], Item.Smu, Item.[Carry Over], Item.[Future Carry Over], Item.[Sold Out], Item.[Sold Out Date], Item.[Sales_Purchase Status - Item], Item.[Sales_Purchase Status Date], Item.[Potential Sold Out], Item.[Advertising Material]
FROM Item
WHERE (((Item.[Configurator Relation])=3))
GROUP BY Item.[Season Code], Item.[Trademark Code], Item.[Collection Code], Item.[Product Sex], Item.[Model Item No_], Item.[Variable Group 01], Item.[Variable Code 01], Item.Smu, Item.[Carry Over], Item.[Future Carry Over], Item.[Sold Out], Item.[Sold Out Date], Item.[Sales_Purchase Status - Item], Item.[Sales_Purchase Status Date], Item.[Potential Sold Out], Item.[Advertising Material]
ORDER BY Item.[Season Code], Item.[Trademark Code], Item.[Model Item No_];

