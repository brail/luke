INSERT INTO [Item Cross Reference] ( [Item No_], [Variant Code], [Unit of Measure], [Cross-Reference Type], [Cross-Reference Type No_], [Cross-Reference No_], Description, [Discontinue Bar Code], [Variable Group 01], [Variable Code 01], [Variable Group 02], [Variable Code 02], [Code Type] )
SELECT Item.No_, "" AS xxx0, "PA" AS xxx1, 3 AS xxx2, "EAN13" AS xxx3, EANTOiMPORT.[EAN/UPC], "EAN13" AS xxx4, 0 AS xxx5, Item.[Variable Group 01], Item.[Variable Code 01], Item.[Variable Group 02], Item.[Variable Code 02], "" AS xxx6
FROM EANTOiMPORT INNER JOIN Item ON (EANTOiMPORT.Material = Item.[Model Item No_]) AND (EANTOiMPORT.taglia = Item.[Variable Code 02]) AND (EANTOiMPORT.Colore = Item.[Variable Code 01]);

