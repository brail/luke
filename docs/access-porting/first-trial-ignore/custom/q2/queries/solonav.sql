SELECT Navision.ShipTO, Navision.Ordine, Navision.Articolo, Navision.Colore, Navision.Assortimento, Navision.Quantita, DatiSap.quantita, navision.quantita-nz(datisap.quantita) AS delta, Navision.ConsRich, Navision.DataCanc, Val([navision.Paia]) AS NavisionPaia, nz([datisap.Paia]) AS PaiaSap
FROM Navision LEFT JOIN DatiSap ON (Navision.Assortimento = DatiSap.assortimento) AND (Navision.Colore = DatiSap.colore) AND (Navision.ShipTO = DatiSap.shipto) AND (Navision.Articolo = DatiSap.Articolo) AND (Navision.Ordine = DatiSap.Ordine)
WHERE (((DatiSap.quantita) Is Null));

