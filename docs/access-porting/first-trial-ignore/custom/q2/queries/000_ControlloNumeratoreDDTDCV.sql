SELECT [DDT_Picking Header].[Posted Date], [DDT_Picking Header].[Posted No_], [DDT_Picking Header].[Document Type], [DDT_Picking Header].No_, [DDT_Picking Header].Status, Left$([Posted No_],4) AS Serie
FROM [DDT_Picking Header]
WHERE ((([DDT_Picking Header].Status)=20))
ORDER BY [DDT_Picking Header].[Posted Date], [DDT_Picking Header].[Posted No_];

