SELECT [confrontoStagioni-step0].SalespersonCode, [confrontoStagioni-step0].Salesperson, [confrontoStagioni-step0].CustomerCode, [confrontoStagioni-step0].CustomerName, Sum([confrontoStagioni-step0].PairsS1) AS PairsS1, Sum([confrontoStagioni-step0].SalesValueS1) AS SalesValueS1, Sum([confrontoStagioni-step0].PairsS2) AS PairsS2, Sum([confrontoStagioni-step0].SalesValueS2) AS SalesValueS2, Sum([confrontoStagioni-step0].PairsS3) AS PairsS3, Sum([confrontoStagioni-step0].SalesValueS3) AS SalesValueS3
FROM [confrontoStagioni-step0]
GROUP BY [confrontoStagioni-step0].SalespersonCode, [confrontoStagioni-step0].Salesperson, [confrontoStagioni-step0].CustomerCode, [confrontoStagioni-step0].CustomerName;

