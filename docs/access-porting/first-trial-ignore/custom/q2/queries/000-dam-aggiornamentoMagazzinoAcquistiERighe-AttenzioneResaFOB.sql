UPDATE Item INNER JOIN [Purchase Line] ON Item.No_ = [Purchase Line].No_ SET [Purchase Line].[Location Code] = "PMAG"
WHERE (((Item.[Season Code])="E22") AND ((Item.[Trademark Code])="AP"));

