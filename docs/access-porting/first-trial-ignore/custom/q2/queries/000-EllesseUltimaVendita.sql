SELECT Item.[trademark code], Sum(Val([quantity])) AS qty, [Item Ledger Entry].[location code], Item.[Model Item No_], Item.[Variable Code 01] AS Color, Val([Direct Unit Cost]) AS Costo, ListinoVendita.Listino, ListinoVendita.[Sales Code]
FROM (([Item Ledger Entry] INNER JOIN Item ON [Item Ledger Entry].[Item No_] = Item.No_) INNER JOIN [Purch_ Price Model Item] ON (Item.[Vendor No_] = [Purch_ Price Model Item].[Vendor No_]) AND (Item.[Model Item No_] = [Purch_ Price Model Item].[Model Item No_])) INNER JOIN ListinoVendita ON [Item Ledger Entry].[Item No_] = ListinoVendita.[Item No_]
GROUP BY Item.[trademark code], [Item Ledger Entry].[location code], Item.[Model Item No_], Item.[Variable Code 01], Val([Direct Unit Cost]), ListinoVendita.Listino, ListinoVendita.[Sales Code]
HAVING (((Item.[trademark code])="ELLESSE") AND ((Sum(Val([quantity])))<>0) AND (([Item Ledger Entry].[location code])<>"FMAG") AND ((ListinoVendita.[Sales Code])="1"));

