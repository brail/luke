SELECT DocType, Type, No_, [VAT Registration No_], [Bill-to Name], [Bill-to Country_Region Code], [Country_Region of Origin Code], [Ship-to Country_Region Code], [Tariff No_], PesoLordo, Unita, Description, ImportoNetto, ImportoLordo, Marchio, Fornitore, DataRegistrazione, Paese, Valuta
FROM IntrastatFattureDiVendita;
UNION ALL SELECT DocType, Type, No_, [VAT Registration No_], [Bill-to Name], [Bill-to Country_Region Code], [Country_Region of Origin Code], [Ship-to Country_Region Code], [Tariff No_], PesoLordo, Unita, Description, ImportoNetto, ImportoLordo, Marchio, Fornitore, DataRegistrazione, Paese, Valuta
FROM IntrastatNoteDiCredito;

