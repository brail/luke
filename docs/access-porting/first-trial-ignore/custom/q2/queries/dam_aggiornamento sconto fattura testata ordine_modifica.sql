UPDATE [Sales Header] INNER JOIN [Sales Line] ON ([Sales Header].No_ = [Sales Line].[Document No_]) AND ([Sales Header].[Document Type] = [Sales Line].[Document Type]) SET [Sales Header].Status = 0, [Sales Header].[Invoice Discount Value] = "8.00000000000000000000"
WHERE ((([Sales Header].[Sell-to Customer No_])="C00302") AND (([Sales Line].[SELLING SEASON CODE])="I22"));

