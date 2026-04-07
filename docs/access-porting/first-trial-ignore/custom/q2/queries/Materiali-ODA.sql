SELECT [Purchase Header].No_, [Purchase Line].No_ AS Article, [Purchase Line].[Constant Variable Code] AS Color, Sum(Val([no_ of pairs])) AS qty, [Model Item Component].No_, Sum(Val([Base Size Quantity])) AS qty_per, Val([Base Size Quantity])*Val([no_ of pairs]) AS qty_tot
FROM [Purchase Header] INNER JOIN ([Purchase Line] INNER JOIN [Model Item Component] ON [Purchase Line].No_ = [Model Item Component].[Model Item No_]) ON [Purchase Header].No_ = [Purchase Line].[Document No_]
GROUP BY [Purchase Header].No_, [Purchase Line].No_, [Purchase Line].[Constant Variable Code], [Model Item Component].No_, Val([Base Size Quantity])*Val([no_ of pairs])
HAVING ((([Purchase Header].No_)=[forms]![principale]![filtroodaean]));

