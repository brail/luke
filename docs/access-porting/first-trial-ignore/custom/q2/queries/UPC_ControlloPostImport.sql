SELECT Item.No_, "" AS xxx0, "PA" AS xxx1, 3 AS xxx2, "EAN13" AS xxx3, upctoimport.[EAN/UPC], "EAN13" AS xxx4, 0 AS xxx5, upctoimport.material, upctoimport.Colore, upctoimport.[material number], upctoimport.taglia, [Item Cross Reference].[Cross-Reference No_]
FROM upctoimport LEFT JOIN (Item LEFT JOIN [Item Cross Reference] ON Item.No_ = [Item Cross Reference].[Item No_]) ON (upctoimport.taglia = Item.[Variable Code 02]) AND (upctoimport.Colore = Item.[Variable Code 01]) AND (upctoimport.Material = Item.[Model Item No_]);

