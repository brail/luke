UPDATE [Sales Header] SET [Sales Header].[Shipment Method Code] = "11"
WHERE ((([Sales Header].[Selling Season Code])="E23" Or ([Sales Header].[Selling Season Code])="I23") AND (([Sales Header].[Shipment Method Code])="1"));

