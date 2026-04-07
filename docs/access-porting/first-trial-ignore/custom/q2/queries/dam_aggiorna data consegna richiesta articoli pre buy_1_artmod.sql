UPDATE ([Sales Line] INNER JOIN ArticoliPreBuy ON ([Sales Line].[Constant Variable Code] = ArticoliPreBuy.Colore) AND ([Sales Line].No_ = ArticoliPreBuy.Articolo)) INNER JOIN [Sales Header] ON [Sales Line].[Document No_] = [Sales Header].No_ SET [Sales Line].[requested delivery date] = #7/20/2022#
WHERE ((([Sales Line].[requested delivery date])=#8/15/2022#) AND (([Sales Header].[ORDER Date])<=[datacutoff]));

