SELECT [nuova priorita].CustomerCode, [nuova priorita].CustomerName, Customer.[RESERVATION PRIORITY], [nuova priorita].[NEW PRIORITY], [NEW PRIORITY]-[RESERVATION PRIORITY] AS Espr1
FROM [nuova priorita] INNER JOIN Customer ON [nuova priorita].CustomerCode = Customer.No_;

