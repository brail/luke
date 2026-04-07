SELECT [DDT_Picking Line].[Document Type], [DDT_Picking Line].[Document No_], [ddt_picking header.Bill-to Customer No_] & "_" & [Bill-to Name] & "_" & [Ship-to Code] AS Destinazione, Sum(Val([quantity])) AS NumeroColli, [DDT_Picking Header].[Selling Season Code], [DDT_Picking Header].[Shortcut Dimension 2 Code] AS Marchio, [DDT_Picking Header].[First Release Date], [DDT_Picking Header].[posted date], [posted date]-[first release date] AS delta
FROM [DDT_Picking Line] INNER JOIN [DDT_Picking Header] ON [DDT_Picking Line].[Document No_] = [DDT_Picking Header].No_
WHERE ((([DDT_Picking Line].Type)=20) AND (([DDT_Picking Header].status)=20))
GROUP BY [DDT_Picking Line].[Document Type], [DDT_Picking Line].[Document No_], [ddt_picking header.Bill-to Customer No_] & "_" & [Bill-to Name] & "_" & [Ship-to Code], [DDT_Picking Header].[Selling Season Code], [DDT_Picking Header].[Shortcut Dimension 2 Code], [DDT_Picking Header].[First Release Date], [DDT_Picking Header].[posted date], [posted date]-[first release date]
HAVING ((([DDT_Picking Line].[Document Type])=0) AND (([DDT_Picking Header].[Selling Season Code])="E22") AND (([DDT_Picking Header].[First Release Date])<>#1/1/1753#))
ORDER BY [posted date]-[first release date] DESC;

