SELECT [Return Receipt Header].No_, [Return Receipt Header].[Posting Date], [Return Receipt Header].[Shipment Date], [Return Receipt Header].[Order Date], [Return Receipt Header].[Document Date], [Return Receipt Line].[Posting Date], [Return Receipt Line].No_, [Return Receipt Line].Quantity
FROM [Return Receipt Line] INNER JOIN [Return Receipt Header] ON [Return Receipt Line].[Document No_] = [Return Receipt Header].No_
WHERE ((([Return Receipt Header].No_)>="CAR-RES-VE-23/02150" And ([Return Receipt Header].No_)<="CAR-RES-VE-23/02207"));

