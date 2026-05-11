SELECT [ShipToCode Diversi-step0].[Document No_] AS Espr1, Count([ShipToCode Diversi-step0].[Ship-to Code]) AS [ConteggioDiShip-to Code]
FROM [ShipToCode Diversi-step0]
GROUP BY [ShipToCode Diversi-step0].[Document No_]
HAVING (((Count([ShipToCode Diversi-step0].[Ship-to Code]))>1));

