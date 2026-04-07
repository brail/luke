INSERT INTO [VenditeEPrenotazioni-CalcoloTotaleCoperto_TABELLA] ( OrdineNumero, OrdineRiga, totaleAssortimentiCoperti, totalePaiaCoperte )
SELECT [VenditeEPrenotazioni-CalcoloTotaleCoperto-step0].OrdineNumero, [VenditeEPrenotazioni-CalcoloTotaleCoperto-step0].OrdineRiga, Sum([VenditeEPrenotazioni-CalcoloTotaleCoperto-step0].assortmentQtyTotal) AS totaleAssortimentiCoperti, Sum([VenditeEPrenotazioni-CalcoloTotaleCoperto-step0].pairsQtyTotal) AS totalePaiaCoperte
FROM [VenditeEPrenotazioni-CalcoloTotaleCoperto-step0]
GROUP BY [VenditeEPrenotazioni-CalcoloTotaleCoperto-step0].OrdineNumero, [VenditeEPrenotazioni-CalcoloTotaleCoperto-step0].OrdineRiga;

