SELECT Customer.[Payment Method Code], Customer.[payment terms code], [Sales Header].[Payment Method Code], [Sales Header].[payment terms code], Customer.[country_region code], Customer.[geographical zone 2], [Sales Header].[Sell-to Customer No_], Customer.Name, [Sales Header].[selling season code]
FROM [Sales Header] INNER JOIN Customer ON [Sales Header].[Sell-to Customer No_] = Customer.No_
WHERE (((Customer.[country_region code])<>"IT") AND (([Sales Header].[selling season code])="E19"));

