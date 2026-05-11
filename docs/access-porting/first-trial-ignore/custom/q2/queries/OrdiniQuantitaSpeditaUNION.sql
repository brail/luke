SELECT qty, [Order No_], "DDT" AS sorgente
FROM OrdiniQuantitaSpeditaDaSorgenteDDT

UNION ALL SELECT qty, [Document No_], "SalesLine" AS sorgente
FROM OrdiniQuantitaSpeditaDaSorgenteRigheOrdini;

UNION ALL SELECT qty, [Order No_], "SalesShipmentLine" AS sorgente
FROM OrdiniQuantitaSpeditaDaSorgenteRigheSpedizioniRegistrate;

