SELECT [Budget Header].[Trademark Code], [Budget Header].[Budget Type], [Budget Header].[Selling Season Code], Count([Budget Header].No_) AS ConteggioDiNo_
FROM [Budget Header]
GROUP BY [Budget Header].[Trademark Code], [Budget Header].[Budget Type], [Budget Header].[Selling Season Code]
HAVING ((([Budget Header].[Selling Season Code])="E21"))
ORDER BY [Budget Header].[Trademark Code], [Budget Header].[Budget Type];

