SELECT [DDT_Picking Header].Status, [DDT_Picking Header].[shortcut Dimension 2 Code], [DDT_Picking Header].[Document Type], [DDT_Picking Header].No_
FROM [DDT_Picking Header]
WHERE ((([DDT_Picking Header].Status)=0) AND (([DDT_Picking Header].[shortcut Dimension 2 Code])="AP") AND (([DDT_Picking Header].[Document Type])=0));

