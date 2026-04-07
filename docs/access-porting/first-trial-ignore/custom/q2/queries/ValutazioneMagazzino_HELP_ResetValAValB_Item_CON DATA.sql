DELETE [Purchase Price].[Vendor No_], [Purchase Price].[Starting Date], *
FROM [Purchase Price]
WHERE ((([Purchase Price].[Vendor No_])="VAL A" Or ([Purchase Price].[Vendor No_])="VAL B") AND (([Purchase Price].[Starting Date])=#5/26/2025#));

