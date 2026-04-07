SELECT [DDT_Picking Header].[Posted Date], [DDT_Picking Header].[Posted No_], [DDT_Picking Header].Status
FROM [DDT_Picking Header]
WHERE ((([DDT_Picking Header].[Posted No_]) Like "DB*") AND (([DDT_Picking Header].Status)=20))
ORDER BY [DDT_Picking Header].[Posted No_];

