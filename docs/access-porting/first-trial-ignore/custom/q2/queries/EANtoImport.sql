SELECT [EAN Codes].Material, [EAN Codes].[Material number], [EAN Codes].Colore, [EAN Codes].taglia, [EAN Codes].[EAN/UPC]
FROM [EAN Codes]
GROUP BY [EAN Codes].Material, [EAN Codes].[Material number], [EAN Codes].Colore, [EAN Codes].taglia, [EAN Codes].[EAN/UPC];

