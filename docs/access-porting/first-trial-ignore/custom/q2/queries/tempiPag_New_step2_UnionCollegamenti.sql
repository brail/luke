SELECT ChiaveMovimentoFatturaNotaCredito, ChiaveMovimentoPagamento, ImportoAbbinato, collegamento, testComp
FROM tempiPag_New_step0_CollegamentoDaFattura

UNION ALL SELECT ChiaveMovimentoFatturaNotaCredito, ChiaveMovimentoPagamento, ImportoAbbinato, collegamento, testComp
FROM tempiPag_New_step1_CollegamentoDaPagamento;

