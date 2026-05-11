SELECT [Trademark Code], [Season Code], [Document No_], [Line No_], QTY, CAT, "" as [Delete Reason]
FROM [PrenotazioniEVenditeTaglia-step01];
UNION ALL SELECT [Trademark Code], [Season Code], [Document No_], [Line No_], QTY, CAT, [Delete Reason]
FROM [PrenotazioniEVenditeTaglia-step02];

