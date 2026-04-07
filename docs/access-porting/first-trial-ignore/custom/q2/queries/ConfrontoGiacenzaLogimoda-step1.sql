SELECT "LOG" AS CAT, Marchio_, Stagione_, [CodiceArticolo] as Articolo_, Colore_, Assortimento, qty, pairs, Location_
FROM [ConfrontoGiacenzeLogimoda-step0];

UNION ALL SELECT "NAV" AS CAT, Marchio_, Stagione_, Articolo, Colore_, Assortimento, -qty, -pairs, Location_
FROM [GIACENZAASSORTIMENTI];

