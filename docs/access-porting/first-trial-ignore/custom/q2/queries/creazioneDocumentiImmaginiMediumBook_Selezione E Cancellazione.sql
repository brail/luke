SELECT [External Linked Documents].*, Item.[season code]
FROM Item INNER JOIN [External Linked Documents] ON Item.No_ = [External Linked Documents].[Source No_]
WHERE (((Item.[season code])="E21"));

