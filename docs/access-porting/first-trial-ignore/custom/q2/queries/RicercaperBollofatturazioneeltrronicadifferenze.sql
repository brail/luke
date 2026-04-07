SELECT [G_L Entry].[Posting Date], [G_L Entry].[G_L Account No_], Val([Amount]) AS IMPORTO, [G_L Entry].[Document No_], [G_L Entry].[Document Type]
FROM [G_L Entry]
WHERE ((([G_L Entry].[Posting Date]) Between [forms]![principale]![datainiziale] And [forms]![principale]![datafinale]) AND (([G_L Entry].[G_L Account No_]) Like "R01*" Or ([G_L Entry].[G_L Account No_])="R0500002" Or ([G_L Entry].[G_L Account No_])="R0500360"));

