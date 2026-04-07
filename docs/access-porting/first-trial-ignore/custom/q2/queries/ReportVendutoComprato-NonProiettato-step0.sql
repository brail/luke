SELECT Linea, Articolo, CodiceColore, Colore, Marchio, Stagione, PaiaComprate, PaiaVendute, Descrizione, Descrizione2, FamigliaProdotto, GenereProdotto, [Collection Code], [Vendor No_], VendorName, manufacturer, manufacturername
FROM [ReportVendutoComprato-NonProiettato-BOTH]

union all SELECT Linea, Articolo, CodiceColore, Colore, Marchio, Stagione, PaiaComprate, PaiaVendute, Descrizione, Descrizione2, FamigliaProdotto, GenereProdotto, [Collection Code], [Vendor No_], VendorName, manufacturer, manufacturername
FROM [ReportVendutoComprato-NonProiettato-soloacq]

UNION ALL SELECT Linea, Articolo, CodiceColore, Colore, Marchio, Stagione, PaiaComprate, PaiaVendute, Descrizione, Descrizione2, FamigliaProdotto, GenereProdotto, [Collection Code], [Vendor No_], VendorName, manufacturer, manufacturername
FROM [ReportVendutoComprato-NonProiettato-solovend];

