SELECT [Document Type] as tipoDocumento, ChiaveMovimentoFatturaNotaCredito, ChiaveMovimentoPagamento, importoabbinato, importoabbinato1, collegamento
FROM tempiPagDocumentiConCollegamentoDaPagamento;

UNION ALL select [Document Type] as tipoDocumento, ChiaveMovimentoFatturaNotaCredito, ChiaveMovimentoPagamento, importoabbinato, importoabbinato1, collegamento
FROM tempiPagDocumentiConCollegamentoDaFatturaNotaCredito;

