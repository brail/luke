UPDATE [DDT_Picking Header] SET [DDT_Picking Header].[Shipping Agent Code] = "2", [DDT_Picking Header].[Shipping Agent Service Code] = "48N"
WHERE ((([DDT_Picking Header].Status)=0 Or ([DDT_Picking Header].Status)=1) AND (([DDT_Picking Header].[Geographical Zone])="19" Or ([DDT_Picking Header].[Geographical Zone])="27") AND (([DDT_Picking Header].[Document Type])=0));

