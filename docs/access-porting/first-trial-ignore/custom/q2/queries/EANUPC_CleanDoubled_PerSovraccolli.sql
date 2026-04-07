SELECT [Cross-Reference No_], [Cross-Reference Type No_], [Cross-Reference Type], [Item No_], [Season code]
FROM EANCodes_CleanDoubled_PerSovraccolli;

UNION ALL select [Cross-Reference No_], [Cross-Reference Type No_], [Cross-Reference Type], [Item No_], [Season code]
FROM UPCCodes_CleanDoubled_PerSovraccolli;

