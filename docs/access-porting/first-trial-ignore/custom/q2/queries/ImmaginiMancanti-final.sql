SELECT IMMAGINIMANCANTI.[Source No_], IMMAGINIMANCANTI.[Constant Variable Code], IMMAGINIMANCANTI.[Linked Document], Item.[Season Code]
FROM Item INNER JOIN IMMAGINIMANCANTI ON Item.No_ = IMMAGINIMANCANTI.[Source No_]
WHERE (((IMMAGINIMANCANTI.[Linked Document])="") AND ((Item.[Season Code])="e17"))
ORDER BY IMMAGINIMANCANTI.[Source No_], IMMAGINIMANCANTI.[Constant Variable Code];

