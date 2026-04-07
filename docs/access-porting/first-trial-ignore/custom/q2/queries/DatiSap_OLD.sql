SELECT Format$([SHIp-TO],"00000") AS shipto, Left([PO number],12) AS Ordine, Sap.Material AS Articolo, aggiungizerisucolore(Format$([Col])) AS colore, Format$([Assortment],"0000") AS assortimento, First(Sap.[Asst#Qty]) AS quantita, Sap.Item, Sum(Sap.[Order qty]) AS Paia
FROM Sap
GROUP BY Format$([SHIp-TO],"00000"), Left([PO number],12), Sap.Material, aggiungizerisucolore(Format$([Col])), Format$([Assortment],"0000"), Sap.Item;

