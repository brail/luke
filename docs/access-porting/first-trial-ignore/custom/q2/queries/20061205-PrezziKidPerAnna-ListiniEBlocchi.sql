SELECT [20061205-PrezziKidPerAnna-ListinoVenditaEPubblico].*, [20061205-PrezziKidPerAnna-BlocchiColori].Value
FROM [20061205-PrezziKidPerAnna-ListinoVenditaEPubblico] LEFT JOIN [20061205-PrezziKidPerAnna-BlocchiColori] ON ([20061205-PrezziKidPerAnna-ListinoVenditaEPubblico].[Variable Code 01] = [20061205-PrezziKidPerAnna-BlocchiColori].[Constant Variable Code]) AND ([20061205-PrezziKidPerAnna-ListinoVenditaEPubblico].[Model Item No_] = [20061205-PrezziKidPerAnna-BlocchiColori].[Model Item No_]);

