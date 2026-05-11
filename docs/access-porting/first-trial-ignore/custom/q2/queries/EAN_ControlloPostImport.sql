SELECT [Item].No_, "" AS xxx0, "PA" AS xxx1, 3 AS xxx2, "EAN13" AS xxx3, EANtoImport.[EAN/UPC], "EAN13" AS xxx4, 0 AS xxx5, EANtoImport.material, EANtoImport.Colore, EANtoImport.[material number], EANtoImport.taglia, [Item Cross Reference].[Cross-Reference No_]
FROM (EANtoImport LEFT JOIN Item ON (EANtoImport.[taglia] = [Item].[Variable Code 02]) AND (EANtoImport.Colore = [Item].[Variable Code 01]) AND (EANtoImport.material = [Item].[Model Item No_])) LEFT JOIN [Item Cross Reference] ON [Item].No_ = [Item Cross Reference].[Item No_];

