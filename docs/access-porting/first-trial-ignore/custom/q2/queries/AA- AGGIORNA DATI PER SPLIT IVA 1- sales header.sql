UPDATE [Sales Header] SET [Sales Header].[VAT Bus_ Posting Group] = "SPLIT"
WHERE ((([Sales Header].[Sell-to Customer No_])="C00646") AND (([Sales Header].[Selling Season Code])="A18" Or ([Sales Header].[Selling Season Code])="E18" Or ([Sales Header].[Selling Season Code])="I1819"));

