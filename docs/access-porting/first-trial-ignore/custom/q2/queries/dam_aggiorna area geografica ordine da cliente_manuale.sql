SELECT Customer.[geographical zone], [Sales Header].[geographical zone], [Sales Header].[selling season code], Customer.No_, [Sales Header].No_
FROM Customer INNER JOIN [Sales Header] ON Customer.No_ = [Sales Header].[Sell-to Customer No_]
WHERE ((([Sales Header].[geographical zone])<>[customer.geographical zone] And ([Sales Header].[geographical zone])="") AND (([Sales Header].[selling season code])="I22"));

