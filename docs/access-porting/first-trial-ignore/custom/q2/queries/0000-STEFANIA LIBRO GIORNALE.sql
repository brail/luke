SELECT [GL Book Entry].*, [G_L Account].Name, [G_L Entry].Description, [GL Book Entry].[Source No_], [GL Book Entry].[Source Type], Val([Debit Amount]) AS dbt, Val([Credit Amount]) AS CRD
FROM ([GL Book Entry] INNER JOIN [G_L Account] ON [GL Book Entry].[G_L Account No_] = [G_L Account].No_) INNER JOIN [G_L Entry] ON [GL Book Entry].[Entry No_] = [G_L Entry].[Entry No_];

