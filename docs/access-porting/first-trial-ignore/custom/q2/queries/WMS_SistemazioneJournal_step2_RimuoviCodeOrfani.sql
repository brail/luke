SELECT [Unique Identifier Documents].*, [Warehouse Journal Line].[Journal Template Name], [Unique Identifier Documents].[Journal Batch Name]
FROM [Unique Identifier Documents] LEFT JOIN [Warehouse Journal Line] ON ([Unique Identifier Documents].[Line No_] = [Warehouse Journal Line].[Line No_]) AND ([Unique Identifier Documents].[Journal Batch Name] = [Warehouse Journal Line].[Journal Batch Name])
WHERE ((([Warehouse Journal Line].[Journal Template Name]) Is Null) AND (([Unique Identifier Documents].[Journal Batch Name])<>""));

