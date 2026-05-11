SELECT [VenditeEPrenotazioni-preExport-step0].*, [giorniritardo]*[pairsqty] AS giorniritardoperpaia, IIf([giorniritardo]>0,[giorniritardo]*[pairsqty],0) AS giorniritardoperpaiasoloritardo, IIf([giorniritardo]>0,"Y","N") AS InRitardo
FROM [VenditeEPrenotazioni-preExport-step0];

