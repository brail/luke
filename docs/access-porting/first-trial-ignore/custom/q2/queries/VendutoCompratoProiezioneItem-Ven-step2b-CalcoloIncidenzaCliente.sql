SELECT [VendutoCompratoProiezioneItem-Ven-step2a-CalcoloIncidenzeCliente].No_, [VendutoCompratoProiezioneItem-Ven-step2a-CalcoloIncidenzeCliente].[Constant Variable Code], Max([VendutoCompratoProiezioneItem-Ven-step2a-CalcoloIncidenzeCliente].Incidenza) AS MaxDiIncidenza
FROM [VendutoCompratoProiezioneItem-Ven-step2a-CalcoloIncidenzeCliente]
GROUP BY [VendutoCompratoProiezioneItem-Ven-step2a-CalcoloIncidenzeCliente].No_, [VendutoCompratoProiezioneItem-Ven-step2a-CalcoloIncidenzeCliente].[Constant Variable Code];

