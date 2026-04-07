SELECT EANCodes.[Cross-Reference No_], EANCodes.[Cross-Reference Type No_], EANCodes.[Cross-Reference Type], EANCodes.[Item No_], Item.[Season code]
FROM EANCodes INNER JOIN Item ON EANCodes.[Item No_] = Item.No_
WHERE (((Item.[Season code])=[forms]![principale]![filtrostagionesovraccolli]));

