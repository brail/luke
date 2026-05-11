SELECT GiacenzaLogimoda.Marchio AS Marchio_, GiacenzaLogimoda.Stagione AS Stagione_, GiacenzaLogimoda.[Codice Articolo] AS CodiceArticolo, IIf(InStr([colore]," ")>0,Left$([colore],InStr([colore]," ")-1),[colore]) AS Colore_, GiacenzaLogimoda.Assortimento, Round([quantita]/[assortmentquantity]) AS qty, GiacenzaLogimoda.Quantita AS pairs, "" AS Location_, GiacenzaLogimoda.COLORE AS Colore_ORI
FROM GiacenzaLogimoda LEFT JOIN AssortimentiQuanrtita_SingoloGruppoVariabili ON GiacenzaLogimoda.Assortimento = AssortimentiQuanrtita_SingoloGruppoVariabili.[Assortment Code]
WHERE (((GiacenzaLogimoda.Marchio)=[FiltroMarchio]) AND ((GiacenzaLogimoda.Stagione)=[FiltroStagione]));

