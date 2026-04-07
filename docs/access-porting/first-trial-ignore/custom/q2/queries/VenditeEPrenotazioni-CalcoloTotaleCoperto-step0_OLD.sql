SELECT [OrdineNumero], [OrdineRiga], Sum(assortmentQty) AS assortmentQtyTotal, Sum(pairsQty) AS pairsQtyTotal
FROM [VenditeEPrenotazioni-InBollaAperta]
GROUP BY [OrdineNumero], [OrdineRiga]

union SELECT [OrdineNumero], [OrdineRiga], Sum(assortmentQty) AS assortmentQtyTotal, Sum(pairsQty) AS pairsQtyTotal
FROM [VenditeEPrenotazioni-InBollaRilasciata]
GROUP BY [OrdineNumero], [OrdineRiga]

UNION ALL SELECT [OrdineNumero], [OrdineRiga], Sum(assortmentQty) AS assortmentQtyTotal, Sum(pairsQty) AS pairsQtyTotal
FROM [VenditeEPrenotazioni-Spedito]
GROUP BY [OrdineNumero], [OrdineRiga]

UNION ALL SELECT [OrdineNumero], [OrdineRiga], Sum(assortmentQty) AS assortmentQtyTotal, Sum(pairsQty) AS pairsQtyTotal
FROM [VenditeEPrenotazioni-PrenotatoAcquisto]
GROUP BY [OrdineNumero], [OrdineRiga]

UNION ALL SELECT [OrdineNumero], [OrdineRiga], Sum(assortmentQty) AS assortmentQtyTotal, Sum(pairsQty) AS pairsQtyTotal
FROM [VenditeEPrenotazioni-PrenotatoGiacenza]
GROUP BY [OrdineNumero], [OrdineRiga];

