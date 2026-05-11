SELECT [0000GLstep0].[Document No_], Count([0000GLstep0].[Posting Date]) AS [ConteggioDiPosting Date]
FROM 0000GLstep0
GROUP BY [0000GLstep0].[Document No_]
HAVING (((Count([0000GLstep0].[Posting Date]))>1));

