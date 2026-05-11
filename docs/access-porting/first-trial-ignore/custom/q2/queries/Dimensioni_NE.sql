SELECT [Dimension Set Entry].[Dimension Set ID], Max(IIf([dimension code]="CCR",[Dimension Value Code],"")) AS CCR, Max(IIf([dimension code]="MARCHIO",[Dimension Value Code],"")) AS MARCHIO, Max(IIf([dimension code]="STAGIONE",[Dimension Value Code],"")) AS STAGIONE, Max(IIf([dimension code]="LINEA",[Dimension Value Code],"")) AS LINEA
FROM [Dimension Set Entry]
GROUP BY [Dimension Set Entry].[Dimension Set ID];

