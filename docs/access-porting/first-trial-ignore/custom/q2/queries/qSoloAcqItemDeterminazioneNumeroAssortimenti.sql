SELECT [Purchase Line].[Document Type], [Purchase Line].[Document No_], [Purchase Line].Type, [Purchase Line].[Line No_], IIf([type]=20,(Val([Quantity])),0) AS NumeroAssortimenti, IIf([type]=20,[Assortment Code],"XXX") AS AssortmentCode
FROM [Purchase Line]
WHERE ((([Purchase Line].Type)=19 Or ([Purchase Line].Type)=20));

