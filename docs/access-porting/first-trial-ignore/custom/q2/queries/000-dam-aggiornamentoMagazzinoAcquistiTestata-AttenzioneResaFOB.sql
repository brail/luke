UPDATE (Item INNER JOIN [Purchase Line] ON Item.No_ = [Purchase Line].No_) INNER JOIN [Purchase Header] ON [Purchase Line].[Document No_] = [Purchase Header].No_ SET [Purchase Header].[Location Code] = "PMAG"
WHERE (((Item.[Season Code])="E22") AND ((Item.[Trademark Code])="AP"));

