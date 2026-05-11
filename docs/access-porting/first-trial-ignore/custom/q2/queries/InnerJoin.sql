SELECT Navision.ShipTO, Navision.Ordine, Navision.Articolo, Navision.Colore, Navision.Assortimento, Navision.Quantita, DatiSap.quantita, navision.quantita-datisap.quantita AS delta, Navision.ConsRich, Navision.DataCanc, Val([navision.Paia]) AS NavisionPaia, DatiSap.Paia
FROM Navision INNER JOIN DatiSap ON (Navision.Ordine=DatiSap.Ordine) AND (Navision.Articolo=DatiSap.Articolo) AND (Navision.ShipTO=DatiSap.shipto) AND (Navision.Colore=DatiSap.colore) AND (Navision.Assortimento=DatiSap.assortimento);

