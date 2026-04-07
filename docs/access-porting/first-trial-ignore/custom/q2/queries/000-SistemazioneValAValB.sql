SELECT Item.[Configurator Relation], Item.No_, Item.[Trademark Code], Item.[Season Code], [Purch_ Price Model Item].[Model Item No_], [Purch_ Price Model Item].[Vendor No_], [Purch_ Price Model Item].[Starting Date], [Purch_ Price Model Item].[Currency Code], [Purch_ Price Model Item].[Constant Variable Code], [Purch_ Price Model Item].[Variable Code 01], [Purch_ Price Model Item].[Variable Code 02], [Purch_ Price Model Item].[Direct Unit Cost], [Purch_ Price Model Item].[Ending Date]
FROM Item LEFT JOIN [Purch_ Price Model Item] ON Item.No_ = [Purch_ Price Model Item].[Model Item No_]
WHERE (((Item.[Configurator Relation])=1) AND ((Item.[Season Code])<>"I1819") and ((Item.[Season Code])<>"E18") and ((Item.[Season Code])<>"E19"));

