SELECT Item.No_, [Purchase Price].[Currency Code], Val([Direct Unit Cost]) AS PurchasePrice
FROM Item INNER JOIN [Purchase Price] ON (Item.No_ = [Purchase Price].[Item No_]) AND (Item.[Vendor No_] = [Purchase Price].[Vendor No_]);

