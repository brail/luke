UPDATE [Purchase Line] SET [Purchase Line].[Return Qty_ to Ship] = Val([quantity])-Val([Return Qty_ Shipped]), [Purchase Line].[Return Qty_ to Ship (Base)] = Val([quantity])-Val([Return Qty_ Shipped])
WHERE ((([Purchase Line].[Document Type])=5) AND ((Val([quantity])-Val([Return Qty_ Shipped]))<>0) AND (([Purchase Line].[Document No_])="ODA-RES-18/00014"));

