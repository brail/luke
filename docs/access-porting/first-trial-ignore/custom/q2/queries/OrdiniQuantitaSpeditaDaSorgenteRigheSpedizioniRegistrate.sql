SELECT [Sales Shipment Line].[Order No_], Sum(Val([quantity])) AS qty
FROM [Sales Shipment Line]
WHERE ((([Sales Shipment Line].Type)=2))
GROUP BY [Sales Shipment Line].[Order No_]
HAVING (((Sum(Val([quantity])))>0));

