SELECT UPCCodes.[Cross-Reference No_], UPCCodes.[Cross-Reference Type No_], UPCCodes.[Cross-Reference Type], UPCCodes.[Item No_], Item.[Season code]
FROM UPCCodes INNER JOIN Item ON UPCCodes.[Item No_] = Item.No_
WHERE (((Item.[Season code])=[forms]![principale]![filtrostagionesovraccolli]));

