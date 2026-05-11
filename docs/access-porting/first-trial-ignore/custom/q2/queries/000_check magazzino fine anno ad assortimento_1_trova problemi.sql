SELECT [Assortment Ledger Entry].[Model Item No_], [Assortment Ledger Entry].[CONSTANT VARIABLE CODE], [Assortment Ledger Entry].[Assortment Code], [Assortment Ledger Entry].[Location Code], Sum(Val([QUANTITY])) AS QTY
FROM [Assortment Ledger Entry]
WHERE ((([Assortment Ledger Entry].[Posting Date])<=[Forms]![principale]![datafinale]))
GROUP BY [Assortment Ledger Entry].[Model Item No_], [Assortment Ledger Entry].[CONSTANT VARIABLE CODE], [Assortment Ledger Entry].[Assortment Code], [Assortment Ledger Entry].[Location Code]
HAVING (((Sum(Val([QUANTITY])))<0));

