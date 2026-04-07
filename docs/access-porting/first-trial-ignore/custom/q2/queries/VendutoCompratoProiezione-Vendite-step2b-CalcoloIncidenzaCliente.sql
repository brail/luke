SELECT [VendutoCompratoProiezione-Vendite-step2a-CalcoloIncidenzeCliente].No_, [VendutoCompratoProiezione-Vendite-step2a-CalcoloIncidenzeCliente].[Constant Variable Code], Max([VendutoCompratoProiezione-Vendite-step2a-CalcoloIncidenzeCliente].Incidenza) AS MaxDiIncidenza
FROM [VendutoCompratoProiezione-Vendite-step2a-CalcoloIncidenzeCliente]
GROUP BY [VendutoCompratoProiezione-Vendite-step2a-CalcoloIncidenzeCliente].No_, [VendutoCompratoProiezione-Vendite-step2a-CalcoloIncidenzeCliente].[Constant Variable Code];

