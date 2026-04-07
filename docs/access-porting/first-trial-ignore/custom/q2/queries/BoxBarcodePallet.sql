SELECT LettureSovraccolliTXT.boxbarcode, LettureSovraccolliTXT.pallet, AnagraficheLogimodaE20.Articolo, AnagraficheLogimodaE20.Colore, AnagraficheLogimodaE20.Assortimento, AnagraficheLogimodaE20.Quantita
FROM LettureSovraccolliTXT LEFT JOIN AnagraficheLogimodaE20 ON LettureSovraccolliTXT.boxbarcode = AnagraficheLogimodaE20.Collo;

