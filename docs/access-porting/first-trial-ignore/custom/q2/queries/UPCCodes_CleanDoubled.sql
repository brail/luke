SELECT UPCCodes.[Cross-Reference No_], UPCCodes.[Cross-Reference Type No_], UPCCodes.[Cross-Reference Type], Max(UPCCodes.[Item No_]) AS [MaxDiItem No_], IIf(Count([cross-reference no_])>1,"Y","N") AS Multiplo
FROM UPCCodes
GROUP BY UPCCodes.[Cross-Reference No_], UPCCodes.[Cross-Reference Type No_], UPCCodes.[Cross-Reference Type];

