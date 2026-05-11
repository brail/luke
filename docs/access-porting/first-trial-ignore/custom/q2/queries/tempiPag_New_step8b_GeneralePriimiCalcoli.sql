SELECT tempiPag_New_step8a_Generale.*, DateDiff("d",[datafattura],[datapagamento]) AS giorniPagamento, DateDiff("d",[datascadenzapagamento],[datapagamento]) AS giorniritardoPagamento, DateDiff("d",[datafattura],[datapagamento])*[importoabbinato] AS giorniPagamentoXImporto, DateDiff("d",[datascadenzapagamento],[datapagamento])*[importoabbinato] AS giorniritardoPagamentoximporto
FROM tempiPag_New_step8a_Generale;

