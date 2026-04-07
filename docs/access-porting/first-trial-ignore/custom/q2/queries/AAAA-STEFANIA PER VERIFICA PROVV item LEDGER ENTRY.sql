SELECT [G_L Entry].[Posting Date], [G_L Entry].[Document No_], [G_L Entry].Description, Dimensioni_NE.MARCHIO, Dimensioni_NE.STAGIONE, Sum(Val([Amount])) AS amount_
FROM [G_L Entry] LEFT JOIN Dimensioni_NE ON [G_L Entry].[Dimension Set ID] = Dimensioni_NE.[Dimension Set ID]
WHERE (((([G_L Entry].[G_L Account No_])>="R0100001" And ([G_L Entry].[G_L Account No_])<="R0199999" And ([G_L Entry].[G_L Account No_])<>"R0100008") Or (([G_L Entry].[G_L Account No_])="R0700481")))
GROUP BY [G_L Entry].[Posting Date], [G_L Entry].[Document No_], [G_L Entry].Description, Dimensioni_NE.MARCHIO, Dimensioni_NE.STAGIONE
HAVING ((([G_L Entry].[Posting Date]) Between #1/1/2018# And #6/30/2018#) AND ((Dimensioni_NE.MARCHIO)="BLAUER") AND ((Dimensioni_NE.STAGIONE)="E18"));

