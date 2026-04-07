UPDATE Customer INNER JOIN [Customer Recipient Relation] ON Customer.No_ = [Customer Recipient Relation].[Customer No_] SET [Customer Recipient Relation].[recipient code] = "XXXXXXX", [Customer Recipient Relation].[Export Transport Information] = 0
WHERE (((Customer.[GEOGRAPHICAL ZONE 2])="34"));

