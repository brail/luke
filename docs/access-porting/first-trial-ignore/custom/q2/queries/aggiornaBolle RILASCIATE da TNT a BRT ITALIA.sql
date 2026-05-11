UPDATE [DDT_Picking Header] SET [DDT_Picking Header].[Shipping Agent Code] = "1", [DDT_Picking Header].[Shipping Agent Service Code] = "C"
WHERE ((([DDT_Picking Header].[Shipping Agent Code])="2") AND (([DDT_Picking Header].[Shipping Agent Service Code])="NC") AND (([DDT_Picking Header].Status)=1) AND (([DDT_Picking Header].[Document Type])=0));

