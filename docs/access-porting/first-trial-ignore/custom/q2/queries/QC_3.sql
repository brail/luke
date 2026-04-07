SELECT [Document Packaging Line].[Document No_], Max([Document Packaging Line].[Package No_]) AS febos_box_all
FROM [Document Packaging Line]
GROUP BY [Document Packaging Line].[Document No_];

