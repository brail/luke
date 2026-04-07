SELECT [CreditoGrigliaAgenti-step0a-contaMarchiAgente].[Sell-to Customer No_], Count([CreditoGrigliaAgenti-step0a-contaMarchiAgente].[trademark code]) AS marchiagente
FROM [CreditoGrigliaAgenti-step0a-contaMarchiAgente]
GROUP BY [CreditoGrigliaAgenti-step0a-contaMarchiAgente].[Sell-to Customer No_];

