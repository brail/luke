SELECt statusRiga, ordineNumero, OrdineRiga, [Source Document No_] AS ordineAcquistoTrasferimentoNumero, [Source Line No_] as OrdineAcquistoTrasferimentoRiga,  assortmentQty, pairsQty, [Date Reservation], [Requested Receipt Date], [Promised Receipt Date], [Planned Receipt Date], [Expected Receipt Date], #01/01/1980#  as TransferReceiptDate, SourceLocation, SalesLocation, [Season Code]
FROM [VenditeEPrenotazioni-PrenotatoAcquisto]


union all SELECt statusRiga, ordineNumero, OrdineRiga, "" ,0 , assortmentQty, pairsQty, #01/01/1980#,   #01/01/1980#,  #01/01/1980#,  #01/01/1980#,  #01/01/1980#, #01/01/1980#, SalesLocation, SalesLocation, [Season Code] 
FROM [VenditeEPrenotazioni-PrenotatoGiacenza]

UNION ALL SELECt statusRiga, ordineNumero, OrdineRiga, [TO Document No_], [TO Line No_], assortmentQty, pairsQty, [Date Reservation],   #01/01/1980#,  #01/01/1980#,  #01/01/1980#,  #01/01/1980#, TransferReceiptDate, SourceLocation, SalesLocation, [Season Code]
FROM [VenditeEPrenotazioni-PrenotatoTrasferimento];



union all SELECt statusRiga, ordineNumero, OrdineRiga, "" ,0 , assortmentQty, pairsQty, #01/01/1980#,   #01/01/1980#,  #01/01/1980#,  #01/01/1980#,  #01/01/1980#, #01/01/1980#, SalesLocation, SalesLocation, [Season Code] 
FROM [VenditeEPrenotazioni-InBollaAperta]

union all SELECt statusRiga, ordineNumero, OrdineRiga, "" ,0 , assortmentQty, pairsQty, #01/01/1980#,  #01/01/1980#,  #01/01/1980#,  #01/01/1980#,  #01/01/1980#, #01/01/1980#, SalesLocation, SalesLocation, [Season Code] 
FROM [VenditeEPrenotazioni-InBollaRilasciata]

union all SELECt statusRiga, ordineNumero, OrdineRiga, "" ,0 , assortmentQty, pairsQty, #01/01/1980#,  #01/01/1980#,  #01/01/1980#,  #01/01/1980#,  #01/01/1980#, #01/01/1980#, SalesLocation, SalesLocation, [Season Code]
FROM [VenditeEPrenotazioni-Spedito]

UNION ALL SELECt statusRiga, ordineNumero, OrdineRiga, "" ,0 , assortmentQty, pairsQty, #01/01/1980#,  #01/01/1980#,  #01/01/1980#,  #01/01/1980#,  #01/01/1980#, #01/01/1980#, SalesLocation, SalesLocation, [Season Code]
FROM [VenditeEPrenotazioni-Scoperto];

