SELECT [Purchase Price].[Item No_], Max([Purchase Price].[Starting Date]) AS [MaxDiStarting Date], Max(Val([Direct Unit Cost])) AS Costo
FROM [Purchase Price]
GROUP BY [Purchase Price].[Item No_];

