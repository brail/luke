SELECT [000-eandoppi-step1].[Cross-Reference No_], Item.No_, Item.[Model Item No_], Item.[Variable Code 01], Item.[Variable Code 02]
FROM [000-eandoppi-step1] INNER JOIN (EANCodes INNER JOIN Item ON EANCodes.[Item No_] = Item.No_) ON [000-eandoppi-step1].[Cross-Reference No_] = EANCodes.[Cross-Reference No_];

