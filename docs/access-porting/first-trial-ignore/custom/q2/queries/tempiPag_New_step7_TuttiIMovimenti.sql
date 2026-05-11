SELECT ChiaveMovimentoFatturaNotaCredito, ChiaveMovimentoPagamento, ImportoAbbinato, collegamento, testComp
FROM tempiPag_New_step0_CollegamentoDaFattura;

union all SELECT ChiaveMovimentoFatturaNotaCredito, ChiaveMovimentoPagamento, ImportoAbbinato, collegamento, testComp
FROM tempiPag_New_step1_CollegamentoDaPagamento;

UNION ALL SELECT ChiaveMovimentoFatturaNotaCredito, 0, ImportoAbbinato, collegamento, ""
FROM tempiPag_New_step6_Residui;

