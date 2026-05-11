SELECT "BOTH" as Tipo, ShipTO, Ordine, Articolo, Colore, Assortimento, Navision.quantita, DatiSap.quantita, delta, Navision.consrich, Navision.datacanc, NavisionPaia, datisap.paia
FROM InnerJoin;

union all SELECT  "SAP-ONLY", ShipTO, Ordine, Articolo, Colore, Assortimento, Navision.quantita, DatiSap.quantita, delta, Navision.consrich, Navision.datacanc, nz(paianav) as paianavision, nz(paia) as paiasap
FROM solosap;

UNION ALL SELECT "NAV-ONLY", ShipTO, Ordine, Articolo, Colore, Assortimento, Navision.quantita, DatiSap.quantita, delta, Navision.consrich, Navision.datacanc, navisionpaia, nz(paiasap) as paiasapp
FROM solonav;

