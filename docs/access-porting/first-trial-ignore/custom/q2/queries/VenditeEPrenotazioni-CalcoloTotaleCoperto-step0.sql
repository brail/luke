SELECT [OrdineNumero], [OrdineRiga], assortmentQty AS assortmentQtyTotal, pairsQty AS pairsQtyTotal
FROM [VenditeEPrenotazioni-InBollaAperta]

UNION ALL SELECT [OrdineNumero], [OrdineRiga], assortmentQty AS assortmentQtyTotal, pairsQty AS pairsQtyTotal
FROM [VenditeEPrenotazioni-InBollaRilasciata]

UNION ALL SELECT [OrdineNumero], [OrdineRiga], assortmentQty AS assortmentQtyTotal, pairsQty AS pairsQtyTotal
FROM [VenditeEPrenotazioni-Spedito]

UNION ALL SELECT [OrdineNumero], [OrdineRiga], assortmentQty AS assortmentQtyTotal, pairsQty AS pairsQtyTotal
FROM [VenditeEPrenotazioni-PrenotatoAcquisto]

UNION ALL SELECT [OrdineNumero], [OrdineRiga], assortmentQty AS assortmentQtyTotal, pairsQty AS pairsQtyTotal
FROM [VenditeEPrenotazioni-PrenotatoTrasferimento]

UNION ALL SELECT [OrdineNumero], [OrdineRiga], assortmentQty AS assortmentQtyTotal, pairsQty AS pairsQtyTotal
FROM [VenditeEPrenotazioni-PrenotatoGiacenza];

