SELECT EANCodes.[Cross-Reference No_] AS CodBarcode, "EAN13" AS CodtipoBarcode, 1 AS Quantita, False AS BloccaCambioMatricolaLotto, Item.[Model Item No_] AS CodArticolo, Item.[Variable Group 02] AS CodTagliaUM, Item.[Variable Code 02] AS etichettaTagliaUm, Item.[Variable Code 01] AS CodColore
FROM EANCodes INNER JOIN Item ON EANCodes.[Item No_] = Item.No_
WHERE (((Item.[Season Code])="E20") AND ((Item.[trademark code])="BEPOSITIVE"));

