SELECT EANCodes.[Cross-Reference No_], EANCodes.[Cross-Reference Type No_], EANCodes.[Cross-Reference Type], Max(EANCodes.[Item No_]) AS [MaxDiItem No_], IIf(Count([cross-reference no_])>1,"Y","N") AS Multiplo
FROM EANCodes
GROUP BY EANCodes.[Cross-Reference No_], EANCodes.[Cross-Reference Type No_], EANCodes.[Cross-Reference Type];

