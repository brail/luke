SELECT "FATT" as tipo, [Bill-to Customer No_], [Bill-to Name], InvoiceNo, [selling season code], [Shortcut Dimension 2 Code], DataFattura, Amount_, GeoZone1, GeoZone2
FROM [FattureENDCRegistrate-step0];
UNION ALL SELECT "NDC" as tipo, [Bill-to Customer No_], [Bill-to Name], InvoiceNo, [selling season code], [Shortcut Dimension 2 Code], DataFattura, -Amount_, GeoZone1, GeoZone2
FROM [FattureENDCRegistrate-step1];

