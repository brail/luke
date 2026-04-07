SELECT [Sales Cr_Memo Header].NSP_Subject1, [Sales Cr_Memo Header].NSP_Subject2, [Sales Cr_Memo Line].[Document No_], Item.[Season Code], Item.[Trademark Code]
FROM ([Sales Cr_Memo Line] INNER JOIN [Sales Cr_Memo Header] ON [Sales Cr_Memo Line].[Document No_] = [Sales Cr_Memo Header].No_) INNER JOIN Item ON [Sales Cr_Memo Line].No_ = Item.No_
GROUP BY [Sales Cr_Memo Header].NSP_Subject1, [Sales Cr_Memo Header].NSP_Subject2, [Sales Cr_Memo Line].[Document No_], Item.[Season Code], Item.[Trademark Code]
HAVING (((Item.[Season Code])=[forms]![principale]![FiltroStagioneAreaAmministrativa]) AND ((Item.[Trademark Code])=[forms]![principale]![filtromarchiotempipagamento]));

