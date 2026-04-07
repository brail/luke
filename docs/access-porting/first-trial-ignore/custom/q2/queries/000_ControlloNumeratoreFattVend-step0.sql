SELECT "FATT" as DocT, Left$([No_],4) AS Serie, [Sales Invoice Header].[Posting Date], [Sales Invoice Header].No_
FROM [Sales Invoice Header]


UNION SELECT "NDC",Left$([No_],4) AS Serie, [Posting Date], No_
FROM [Sales Cr_memo Header];

