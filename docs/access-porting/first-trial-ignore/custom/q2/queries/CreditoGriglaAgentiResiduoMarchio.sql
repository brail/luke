SELECT [CreditoGriglaAgentiResiduoMarchio-step0].[Customer No_], Sum([CreditoGriglaAgentiResiduoMarchio-step0].STD) AS STD, Sum([CreditoGriglaAgentiResiduoMarchio-step0].Extra) AS Extra, [CreditoGriglaAgentiResiduoMarchio-step0].marchio
FROM [CreditoGriglaAgentiResiduoMarchio-step0]
GROUP BY [CreditoGriglaAgentiResiduoMarchio-step0].[Customer No_], [CreditoGriglaAgentiResiduoMarchio-step0].marchio;

