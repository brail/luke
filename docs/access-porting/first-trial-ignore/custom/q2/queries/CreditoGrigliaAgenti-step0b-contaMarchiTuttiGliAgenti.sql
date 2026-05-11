SELECT [CreditoGrigliaAgenti-step0a-contaMarchiTuttiGliAgenti].[Sell-to Customer No_], Count([CreditoGrigliaAgenti-step0a-contaMarchiTuttiGliAgenti].[trademark code]) AS marchituttigliagenti
FROM [CreditoGrigliaAgenti-step0a-contaMarchiTuttiGliAgenti]
GROUP BY [CreditoGrigliaAgenti-step0a-contaMarchiTuttiGliAgenti].[Sell-to Customer No_];

