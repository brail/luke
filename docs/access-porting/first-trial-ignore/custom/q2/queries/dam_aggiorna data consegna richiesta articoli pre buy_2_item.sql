UPDATE ([Sales Line] INNER JOIN [Sales Header] ON [Sales Line].[Document No_] = [Sales Header].No_) INNER JOIN ArticoliPreBuy ON ([Sales Line].[Variable Code 01] = ArticoliPreBuy.Colore) AND ([Sales Line].[Model Item No_] = ArticoliPreBuy.Articolo) SET [Sales Line].[requested delivery date] = #7/20/2022#
WHERE ((([Sales Line].[requested delivery date])=#8/15/2022#) AND (([Sales Header].[oRDER Date])<=[datacutoff]));

