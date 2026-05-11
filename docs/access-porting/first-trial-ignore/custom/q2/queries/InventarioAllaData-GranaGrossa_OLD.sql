SELECT Sum(IIf(IsNull([COSTIACQUISTI.ITEM NO_])=False,Val([Quantity])*[costo],999999)) AS Valore, Sum(Val([Quantity])) AS Paia, Sum(IIf(Val([Quantity])>0,Val([Quantity]),0)) AS PaiaEntrate, Sum(IIf(Val([Quantity])<0,Val([Quantity]),0)) AS PaiaUscite, Item.[Configurator Relation], [Item Ledger Entry].[Location Code], Item.[Trademark Code], Item.[Collection Code], Item.[Line Code], Item.[Model Item No_], Item.[Season Code]
FROM ([Item Ledger Entry] INNER JOIN Item ON [Item Ledger Entry].[Item No_] = Item.No_) LEFT JOIN CostiAcquisti ON Item.No_ = CostiAcquisti.[Item No_]
WHERE ((([Item Ledger Entry].[Posting Date])<=[forms]![principale]![datafinale]))
GROUP BY Item.[Configurator Relation], [Item Ledger Entry].[Location Code], Item.[Trademark Code], Item.[Collection Code], Item.[Line Code], Item.[Model Item No_], Item.[Season Code]
HAVING (((Sum(Val([Quantity])))<>0) AND ((Item.[Configurator Relation])=3));

