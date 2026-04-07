SELECT [Document Dimension].[Table ID], Max(IIf([dimension code]="linea",[dimension value code],"")) AS dimLinea, Max(IIf([dimension code]="marchio",[dimension value code],"")) AS dimMarchio, Max(IIf([dimension code]="CCR",[dimension value code],"")) AS dimCCR, Max(IIf([dimension code]="Stagione",[dimension value code],"")) AS dimStagione, [Document Dimension].[Document Type], [Document Dimension].[Document No_], [Document Dimension].[Line No_]
FROM [Document Dimension]
GROUP BY [Document Dimension].[Table ID], [Document Dimension].[Document Type], [Document Dimension].[Document No_], [Document Dimension].[Line No_]
HAVING ((([Document Dimension].[Table ID])=37));

