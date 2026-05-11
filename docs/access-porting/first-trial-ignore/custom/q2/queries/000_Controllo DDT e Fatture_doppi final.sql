SELECT [000_Controllo DDT e Fatture_Detail].*
FROM [000_Controllo DDT e Fatture_doppi step0] INNER JOIN [000_Controllo DDT e Fatture_Detail] ON [000_Controllo DDT e Fatture_doppi step0].[DDT No_] = [000_Controllo DDT e Fatture_Detail].[DDT No_]
ORDER BY [000_Controllo DDT e Fatture_Detail].[DDT No_];

