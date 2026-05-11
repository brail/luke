UPDATE [Sales Header] INNER JOIN [Sales Line] ON [Sales Header].No_ = [Sales Line].[Document No_] SET [Sales Header].[Requested Delivery Date] = #8/12/2020#, [Sales Line].[Requested Delivery Date] = #8/12/2020#
WHERE ((([Sales Header].[Requested Delivery Date])=#7/20/2020#) AND (([Sales Line].[Requested Delivery Date])=#7/20/2020#) AND (([Sales Line].[selling season code])="I20") AND (([Sales Header].[Shortcut Dimension 2 Code])="NAPA"));

