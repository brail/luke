SELECT Sap.[PO number], Sum(Sap.[Order qty]) AS [SommaDiOrder qty]
FROM Sap
GROUP BY Sap.[PO number];

