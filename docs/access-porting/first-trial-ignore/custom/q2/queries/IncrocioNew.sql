SELECT Item.[Trademark Code], Item.[Season Code], Item.[Product Sex], VenditeCoin.*, Item.[Variable Code 01], Item.[Variable Code 02], IIf([quantita]>0,"V","R") AS tipoMovimento
FROM (VenditeCoin LEFT JOIN EANCodes ON VenditeCoin.EANCode = EANCodes.[Cross-Reference No_]) LEFT JOIN Item ON EANCodes.[Item No_] = Item.No_;

