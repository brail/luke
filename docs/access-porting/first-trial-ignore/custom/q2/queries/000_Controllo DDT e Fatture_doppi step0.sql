SELECT [000_Controllo DDT e Fatture_Detail].[DDT No_], Count([000_Controllo DDT e Fatture_Detail].[Document No_]) AS [ConteggioDiDocument No_]
FROM [000_Controllo DDT e Fatture_Detail]
GROUP BY [000_Controllo DDT e Fatture_Detail].[DDT No_]
HAVING (((Count([000_Controllo DDT e Fatture_Detail].[Document No_]))>1));

