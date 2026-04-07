SELECT [Unique Identifier Pst_ Docnts].*, [Item Identifier].Status, [Item Identifier].[Last Bin Code Used], [Item Identifier].[Item No_], [Item Identifier].[Constant Variable Code], [Item Identifier].[Assortment Code]
FROM [Unique Identifier Pst_ Docnts] INNER JOIN [Item Identifier] ON [Unique Identifier Pst_ Docnts].Code = [Item Identifier].Code;

