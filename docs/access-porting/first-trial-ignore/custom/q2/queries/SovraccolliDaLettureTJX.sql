SELECT SovraccolliDaLetture.CARTONE, Sum(SovraccolliDaLetture.Pezzi) AS Pezzi, SovraccolliDaLetture.Article, SovraccolliDaLetture.Colore
FROM SovraccolliDaLetture
GROUP BY SovraccolliDaLetture.CARTONE, SovraccolliDaLetture.Article, SovraccolliDaLetture.Colore;

