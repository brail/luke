UPDATE [Sales Line] SET [Sales Line].[Return Qty_ to Receive (Base)] = Val([quantity])-Val([return qty_ received ]), [Sales Line].[Return Qty_ to Receive] = Val([quantity])-Val([return qty_ received ])
WHERE ((([Sales Line].[Document Type])=5) AND ((Val([quantity])-Val([return qty_ received ]))<>0));

