SELECT "Carico" AS TipoMovimento, [DDT_Picking Header].No_ AS NoDocumento, [DDT_Picking Header].[Posted Date] AS DataVendita, EANCodes.[Cross-Reference No_] AS EANCode, Val([quantity]) AS quantita, [DDT_Picking Line].[Model Item No_] AS Articolo, [DDT_Picking Line].[Variable Code 01] AS Colore, [DDT_Picking Line].[Variable Code 02] AS Taglia, Item.[Trademark Code] AS Marchio, Item.[Season Code] AS Stagione
FROM (([DDT_Picking Header] INNER JOIN [DDT_Picking Line] ON [DDT_Picking Header].No_ = [DDT_Picking Line].[Document No_]) LEFT JOIN EANCodes ON [DDT_Picking Line].No_ = EANCodes.[Item No_]) INNER JOIN Item ON [DDT_Picking Line].No_ = Item.No_
WHERE ((([DDT_Picking Header].No_)=[Forms]![Principale]![FiltroDDTPerNegozioOutlet]) AND (([DDT_Picking Line].Type)=2));

