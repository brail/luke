SELECT [20070216-CarichiLavoroFebos-OdvPerData].[Document Date], nz([PaiaOrdini])+nz([PaiaDDT]) AS TotalePaia, [20070216-CarichiLavoroFebosDDTPerData].PaiaDDT, [20070216-CarichiLavoroFebos-OdvPerData].PaiaOrdini
FROM [20070216-CarichiLavoroFebosDDTPerData] RIGHT JOIN [20070216-CarichiLavoroFebos-OdvPerData] ON [20070216-CarichiLavoroFebosDDTPerData].[Posted Date] = [20070216-CarichiLavoroFebos-OdvPerData].[Document Date]
WHERE ((([20070216-CarichiLavoroFebosDDTPerData].[Posted Date]) Is Null));

