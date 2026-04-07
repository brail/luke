SELECT [Item].No_, [Model Item Variable Group].[Variable Code Limit], [20061205-PrezziKidPerAnna-ListiniEBlocchi].*
FROM (Item LEFT JOIN [20061205-PrezziKidPerAnna-ListiniEBlocchi] ON [Item].No_ = [20061205-PrezziKidPerAnna-ListiniEBlocchi].[Model Item No_]) LEFT JOIN [Model Item Variable Group] ON ([Item].[Constant Assortment Var_Grp_] = [Model Item Variable Group].[Variable Group]) AND ([Item].No_ = [Model Item Variable Group].[Model Item No_])
WHERE ((([Item].[Trademark Code])=[marchio]) AND (([Item].[Season Code])=[stagione]) AND (([Item].[Configurator Relation])=1));

