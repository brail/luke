UPDATE Customer INNER JOIN [Sales Header] ON Customer.No_ = [Sales Header].[Sell-to Customer No_] SET [Sales Header].[Bill-to Address] = [CUSTOMER.ADDRESS], [Sales Header].[Bill-to Post Code] = [CUSTOMER.POST CODE], [Sales Header].[Sell-to Address] = [CUSTOMER.ADDRESS], [Sales Header].[Sell-to Post Code] = [CUSTOMER.POST CODE]
WHERE (((Customer.No_)="C08259") AND (([Sales Header].[SELLING SEASON CODE])="I24"));

