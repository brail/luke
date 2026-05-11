SELECT [G_L Entry].[Document No_], Sum(Val([Amount])) AS IMPORTO, [G_L Entry].[Posting Date], Left$([document No_],2) AS inizio
FROM [G_L Entry]
WHERE ((([G_L Entry].[G_L Account No_]) Like "R0100001" Or ([G_L Entry].[G_L Account No_]) Like "R0100202"))
GROUP BY [G_L Entry].[Document No_], [G_L Entry].[Posting Date], Left$([document No_],2)
HAVING ((([G_L Entry].[Posting Date]) Between #1/1/2019# And #4/30/2019#) AND ((Left$([document No_],2))="FV"));

