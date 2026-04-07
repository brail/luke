UPDATE OrdiniDaModificare INNER JOIN [Sales Header] ON OrdiniDaModificare.[Document No_] = [Sales Header].No_ SET [Sales Header].[shipping agent code] = [CodSpedizioniere], [Sales Header].[Shipping Agent Service Code] = [CodServizio], [Sales Header].[shipment due to] = 1;

