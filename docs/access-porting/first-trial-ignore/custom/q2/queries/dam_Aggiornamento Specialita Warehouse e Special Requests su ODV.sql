UPDATE [per aggiornamento nav_] INNER JOIN ([Sales Header Extension] INNER JOIN ([Sales Header] INNER JOIN Customer ON [Sales Header].[Sell-to Customer No_] = Customer.No_) ON ([Sales Header Extension].[Document No_] = [Sales Header].No_) AND ([Sales Header Extension].[Document Type] = [Sales Header].[Document Type])) ON [per aggiornamento nav_].CustomerCode = Customer.No_ SET [Sales Header Extension].[Warehouse Speciality Code] = [SPECIALITA'], [Sales Header Extension].[Special Requests] = [per aggiornamento NAV_.Special Requests_]
WHERE ((([Sales Header].[selling season code])="I25"));

