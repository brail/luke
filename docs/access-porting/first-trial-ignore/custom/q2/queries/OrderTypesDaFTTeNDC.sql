SELECT "fatt" as doctype, [Sales Invoice Header].No_, [Sales Invoice Header].[Order Types]
FROM [Sales Invoice Header];

UNION ALL SELECt "ndc" as doctype,   No_, [Order Types]
FROM [Sales cr_memo Header];

