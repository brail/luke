SELECT [Warehouse Activity Header].[Whse_ Document Ref_ No_], [Warehouse Activity Header].No_, Sum(Val([quantity])) AS Prel_qty
FROM [Warehouse Activity Line] INNER JOIN [Warehouse Activity Header] ON [Warehouse Activity Line].No_ = [Warehouse Activity Header].No_
WHERE ((([Warehouse Activity Line].[action type])=1) AND (([Warehouse Activity Header].[Whse_ Phase Code])="OUT.PRE"))
GROUP BY [Warehouse Activity Header].[Whse_ Document Ref_ No_], [Warehouse Activity Header].No_;

