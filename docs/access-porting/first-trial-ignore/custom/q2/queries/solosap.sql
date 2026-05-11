SELECT DatiSap.shipto, DatiSap.Ordine, DatiSap.Articolo, DatiSap.colore, DatiSap.assortimento, Navision.Quantita, DatiSap.quantita, nz(navision.quantita)-datisap.quantita AS delta, Navision.ConsRich, Navision.DataCanc, nz([navision.Paia]) AS PaiaNav, DatiSap.Paia
FROM Navision RIGHT JOIN DatiSap ON (Navision.Assortimento = DatiSap.assortimento) AND (Navision.Colore = DatiSap.colore) AND (Navision.ShipTO = DatiSap.shipto) AND (Navision.Articolo = DatiSap.Articolo) AND (Navision.Ordine = DatiSap.Ordine)
WHERE (((Navision.Quantita) Is Null));

