SELECT Format$([SHIp-TO],"00000") AS shipto, Left([PO number],12) AS Ordine, Left$([Material],Len([material])-3) AS Articolo, aggiungizerisucolore(Format$([Col])) AS colore, Format$([Assortment],"0000") AS assortimento, Sap.[Asst#Qty] AS quantita, Sap.[Order qty] AS Paia
FROM Sap;

