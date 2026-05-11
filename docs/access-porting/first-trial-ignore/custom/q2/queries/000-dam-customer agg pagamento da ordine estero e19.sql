UPDATE [Sales Header] INNER JOIN Customer ON [Sales Header].[Sell-to Customer No_] = Customer.No_ SET Customer.[Payment Method Code] = [Sales Header.Payment Method Code], Customer.[payment terms code] = [Sales Header.payment terms code]
WHERE (((Customer.[country_region code])<>"IT") AND (([Sales Header].[selling season code])="E19"));

