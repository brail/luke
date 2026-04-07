SELECT [Sales Header].[Sell-to Customer No_], [Sales Line].[SELLING SEASON CODE], [Sales Header].No_, [Sales Header].Status, [Sales Line].[Line No_], [Sales Header].[Invoice Disc_ Code], [Sales Header].[Invoice Discount Calculation], [Sales Header].[Invoice Discount Value], [Sales Line].[Allow Invoice Disc_], [Sales Line].[Recalculate Invoice Disc_], [Sales Line].[Inv_ Discount Amount], [Sales Line].[Inv_ Disc_ Amount to Invoice], [Sales Line].[delete reason]
FROM [Sales Header] INNER JOIN [Sales Line] ON ([Sales Header].No_ = [Sales Line].[Document No_]) AND ([Sales Header].[Document Type] = [Sales Line].[Document Type])
WHERE ((([Sales Header].[Sell-to Customer No_])="C00302") AND (([Sales Line].[SELLING SEASON CODE])="I22"));

