SELECT [Warehouse Activity Line].[action type], [Warehouse Activity Line].[Link To Source No_], [Warehouse Activity Line].[Link To Source Line No_], [Unique Identifier Documents].Code, [Warehouse Activity Line].No_
FROM [Unique Identifier Documents] INNER JOIN [Warehouse Activity Line] ON ([Unique Identifier Documents].[Line No_] = [Warehouse Activity Line].[Line No_]) AND ([Unique Identifier Documents].No_ = [Warehouse Activity Line].No_)
WHERE ((([Warehouse Activity Line].[action type])=0));

