SELECT [Posted Document Dimension].[Table ID], [Posted Document Dimension].[Document No_], [Posted Document Dimension].[Dimension Code], First([Posted Document Dimension].[Dimension Value Code]) AS CodiceCCR
FROM [Posted Document Dimension]
GROUP BY [Posted Document Dimension].[Table ID], [Posted Document Dimension].[Document No_], [Posted Document Dimension].[Dimension Code]
HAVING ((([Posted Document Dimension].[Table ID])=113 Or ([Posted Document Dimension].[Table ID])=115) AND (([Posted Document Dimension].[Dimension Code])="CCR"));

