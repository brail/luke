SELECT Item.[Model Item No_], Sum(Val([Quantity])) AS Paia
FROM ([Item Ledger Entry] INNER JOIN Item ON [Item Ledger Entry].[Item No_] = Item.No_) LEFT JOIN ValutazioneMagazzino_RelazioneMagazzinoFornitorePrezzo ON [Item Ledger Entry].[Location Code] = ValutazioneMagazzino_RelazioneMagazzinoFornitorePrezzo.CodiceMagazzino
WHERE ((([Item Ledger Entry].[Posting Date])<=[forms]![principale]![datacreazionevalorimagazzino]))
GROUP BY Item.[Model Item No_], Item.[Configurator Relation]
HAVING (((Sum(Val([Quantity])))<>0) AND ((Item.[Configurator Relation])=3));

