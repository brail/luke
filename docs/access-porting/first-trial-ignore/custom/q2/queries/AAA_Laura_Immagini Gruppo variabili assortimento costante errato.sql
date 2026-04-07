SELECT Item.No_, Item.[Constant Assortment Var_Grp_], [External Linked Documents].[Constant Assortment Var_Grp_], Item.[season code]
FROM Item INNER JOIN [External Linked Documents] ON Item.No_ = [External Linked Documents].[Source No_]
WHERE ((([External Linked Documents].[Constant Assortment Var_Grp_])<>[Item.Constant Assortment Var_Grp_]));

