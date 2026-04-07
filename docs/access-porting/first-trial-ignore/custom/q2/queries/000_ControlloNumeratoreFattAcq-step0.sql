SELECT "FATT" as DocT, Left$([No_],4) AS Serie, [Posting Date], No_
FROM [Purch_ Inv_ Header]


UNION SELECT "NDC",Left$([No_],4) AS Serie, [Posting Date], No_
FROM [Purch_ Cr_ Memo Hdr_];

