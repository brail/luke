SELECT [tempiPagBaseDocumentiDaVerificareQueryGenerale-step1].*, DateDiff("d",[datafattura],[datapagamento]) AS giorniPagamento, DateDiff("d",[datascadenzapagamento],[datapagamento]) AS giorniritardoPagamento, DateDiff("d",[datafattura],[datapagamento])*[importoabbinatocalcolato] AS giorniPagamentoXImporto, DateDiff("d",[datascadenzapagamento],[datapagamento])*[importoabbinatocalcolato] AS giorniritardoPagamentoximporto
FROM [tempiPagBaseDocumentiDaVerificareQueryGenerale-step1];

