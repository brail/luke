SELECT EANUPCCodes.[Cross-Reference No_], EANUPCCodes.[Cross-Reference Type No_], EANUPCCodes.[Cross-Reference Type], EANUPCCodes.[Item No_], Item.[Season code]
FROM EANUPCCodes INNER JOIN Item ON EANUPCCodes.[Item No_] = Item.No_
WHERE (((Item.[Season code])=[forms]![principale]![FiltroStagioneControlliLettureBLAC]));

