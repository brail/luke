SELECT [000-ricercaordinismithsconarticolidoppi].[Document No_], Count([000-ricercaordinismithsconarticolidoppi].[Season Code]) AS [ConteggioDiSeason Code]
FROM [000-ricercaordinismithsconarticolidoppi]
GROUP BY [000-ricercaordinismithsconarticolidoppi].[Document No_]
HAVING (((Count([000-ricercaordinismithsconarticolidoppi].[Season Code]))>1));

