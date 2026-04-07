SELECT [Purch_ Price Model Item].[Vendor No_], Item.[Trademark Code], Item.[Season Code], [Purch_ Price Model Item].[Model Item No_], Max([Purch_ Price Model Item].[Starting Date]) AS [MaxDiStarting Date]
FROM [000-SelezioneArticoliPerSecondoValA_311220] LEFT JOIN (Item RIGHT JOIN [Purch_ Price Model Item] ON Item.No_ = [Purch_ Price Model Item].[Model Item No_]) ON [000-SelezioneArticoliPerSecondoValA_311220].ModelItemNo_ = [Purch_ Price Model Item].[Model Item No_]
GROUP BY [Purch_ Price Model Item].[Vendor No_], Item.[Trademark Code], Item.[Season Code], [Purch_ Price Model Item].[Model Item No_]
HAVING ((([Purch_ Price Model Item].[Vendor No_])="VAL A") AND ((Item.[Trademark Code])=[forms]![principale]![filtromarchiopersvalutazione]) AND ((Item.[Season Code])=[forms]![principale]![filtrostagionepersvalutazione]));

