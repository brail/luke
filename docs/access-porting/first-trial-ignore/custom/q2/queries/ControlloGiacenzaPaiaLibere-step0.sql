SELECT [Assortment Ledger Entry Item].[Item No_], Sum(Val([Quantity])) AS quantita, [Assortment Ledger Entry Item].[Location Code]
FROM [Assortment Ledger Entry Item]
WHERE ((([Assortment Ledger Entry Item].[Posting Date])<=[forms]![principale]![FiltroDataPerControlloGiacenze]))
GROUP BY [Assortment Ledger Entry Item].[Item No_], [Assortment Ledger Entry Item].[Location Code]
HAVING (((Sum(Val([Quantity])))>0));

