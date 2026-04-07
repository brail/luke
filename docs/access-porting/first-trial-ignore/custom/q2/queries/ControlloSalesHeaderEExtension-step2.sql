SELECT "Extension Only" AS [Check], [Sales Header].[Document Type] AS SH_DocType, [Sales Header].No_, [Sales Header Extension].[Document Type] AS SHE_DocType, [Sales Header Extension].[Document No_], "" AS [Selling Season Code]
FROM [Sales Header] RIGHT JOIN [Sales Header Extension] ON ([Sales Header].No_ = [Sales Header Extension].[Document No_]) AND ([Sales Header].[Document Type] = [Sales Header Extension].[Document Type])
WHERE ((([Sales Header].No_) Is Null));

