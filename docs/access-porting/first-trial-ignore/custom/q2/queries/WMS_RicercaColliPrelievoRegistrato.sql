SELECT [Registered Whse_ Activity Line].[action type], [Registered Whse_ Activity Line].[Link To Source No_], [Registered Whse_ Activity Line].[Link To Source Line No_], [Unique Identifier Pst_ Docnts].Code, [Registered Whse_ Activity Line].No_, [Registered Whse_ Activity Line].[Whse_ Document No_]
FROM [Unique Identifier Pst_ Docnts] INNER JOIN [Registered Whse_ Activity Line] ON ([Registered Whse_ Activity Line].[Line No_] = [Unique Identifier Pst_ Docnts].[Line No_]) AND ([Unique Identifier Pst_ Docnts].No_ = [Registered Whse_ Activity Line].No_)
WHERE ((([Registered Whse_ Activity Line].[action type])=1) AND (([Registered Whse_ Activity Line].No_)="WPWR-2500262"));

