SELECT Customer.No_, Customer.Name, Customer.[Current Risk], Customer.[Updated Date], Customer.[Updated Type], Customer.[Due Date], Customer.[Internal Valuation], Customer.[Valuation Date], Val([Credit Limit]) AS CreditLimit, Customer.Protest, Customer.[Protest No_], Val([protest amount]) AS ProtestAmount, Customer.[Protest Last Data]
FROM Customer;

