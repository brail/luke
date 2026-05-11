SELECT DocType, Type, No_, [VAT Registration No_], [Pay-to Name], [Pay-to Country_Region Code], [Country_Region of Origin Code], [Tariff No_], PesoLordo, Unita, Description, ImportoNetto, ImportoLordo, Marchio, Fornitore, DataRegistrazione, Paese, Valuta
FROM IntrastatFattureDiAcquisto
UNION ALL SELECT DocType, Type, No_, [VAT Registration No_], [Pay-to Name], [Pay-to Country_Region Code], [Country_Region of Origin Code], [Tariff No_], PesoLordo, Unita, Description, ImportoNetto, ImportoLordo, Marchio, Fornitore, DataRegistrazione, Paese, Valuta
FROM IntrastatNoteDiCreditoAcquisto;

