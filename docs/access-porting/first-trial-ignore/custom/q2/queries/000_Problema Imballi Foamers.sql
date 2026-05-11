SELECT [Purchase Line].[Document No_], [Purchase Line].[Line No_], [Document Packaging Header].*, [Document Packaging Line].*
FROM ([Document Packaging Line] RIGHT JOIN [Document Packaging Header] ON ([Document Packaging Line].[Package No_] = [Document Packaging Header].[Package No_]) AND ([Document Packaging Line].[Document No_] = [Document Packaging Header].[Document No_]) AND ([Document Packaging Line].[Document Type] = [Document Packaging Header].[Document Type])) LEFT JOIN [Purchase Line] ON ([Document Packaging Line].[Document Line No_] = [Purchase Line].[Line No_]) AND ([Document Packaging Line].[Document No_] = [Purchase Line].[Document No_])
WHERE ((([Document Packaging Header].[Document No_])="ODA-24-00001"));

