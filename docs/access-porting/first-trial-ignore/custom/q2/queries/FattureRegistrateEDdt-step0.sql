SELECT [DDT_Picking Header].*, [Transport Reason Code].Description AS TransportDescription, IIf([Enable Transfer-to Location]=1,"YES","NO") AS OnlyTransfer
FROM [DDT_Picking Header] LEFT JOIN [Transport Reason Code] ON [DDT_Picking Header].[Transport Reason Code] = [Transport Reason Code].Code
WHERE ((([DDT_Picking Header].[Posted Date]) Between [Forms]![Principale]![DataIniziale] And [Forms]![Principale]![DataFinale]));

