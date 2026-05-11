INSERT INTO [External Linked Documents] ( [Source Type], [Source No_], [Source Line No_], [Line No_], [Document Type], Description, [Linked Document], [Constant Assortment Var_Grp_], [Constant Variable Code] )
SELECT TmpTable.[Source Type], TmpTable.[Source No_], TmpTable.[Source Line No_], TmpTable.[Line No_], TmpTable.[Document Type], TmpTable.Description, TmpTable.[Linked Document], TmpTable.[Constant Assortment Var_Grp_], TmpTable.[Constant Variable Code]
FROM TmpTable;

