SELECT datiLince.[Rif#], Max(datiLince.[Evaso il]) AS DataEvasione, datiLince.Servizio
FROM datiLince
WHERE (((datiLince.[Rischio Oggi])<>""))
GROUP BY datiLince.[Rif#], datiLince.Servizio
HAVING (((datiLince.[Rif#])<>"") AND ((datiLince.Servizio)="global risk"))
ORDER BY datiLince.[Rif#];

