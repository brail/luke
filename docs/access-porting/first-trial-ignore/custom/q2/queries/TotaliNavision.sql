SELECT Navision.Ordine, Sum(Navision.Quantita) AS SommaDiQuantita, Sum(Navision.Paia) AS SommaDiPaia
FROM Navision
GROUP BY Navision.Ordine;

