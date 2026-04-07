SELECT [DDT_Picking Header].[Document Type], [DDT_Picking Line].[Sell-to Customer No_], [DDT_Picking Header].[Bill-to Customer No_], [DDT_Picking Header].[Bill-to Name], [DDT_Picking Line].[Document No_], [DDT_Picking Line].[Line No_], [DDT_Picking Line].No_, [DDT_Picking Line].[Constant Variable Code], [DDT_Picking Header].STATUS
FROM [DDT_Picking Line] INNER JOIN [DDT_Picking Header] ON [DDT_Picking Line].[Document No_] = [DDT_Picking Header].No_
WHERE ((([DDT_Picking Header].[Document Type])=0) AND (([DDT_Picking Line].No_)="NP0A88XV"));

