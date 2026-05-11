SELECT [DDT_Picking Line].[Order No_], [DDT_Picking Line].[Order Line No_], Sum(Val([No_ of Pairs])) AS PaiaInBollaTotale, Sum(Val([Quantity])) AS QuantitaInBollaTotale, Sum(IIf([status]=1,Val([No_ of Pairs]),0)) AS PaiaInBollaRilasciate, Sum(IIf([status]=1,Val([Quantity]),0)) AS QuantitaInBollaRilasciate, Sum(IIf([status]=0,Val([No_ of Pairs]),0)) AS PaiaInBollaAperte, Sum(IIf([status]=0,Val([Quantity]),0)) AS QuantitaInBollaAperte
FROM [DDT_Picking Line] INNER JOIN [DDT_Picking Header] ON ([DDT_Picking Line].[Document Type] = [DDT_Picking Header].[Document Type]) AND ([DDT_Picking Line].[Document No_] = [DDT_Picking Header].No_)
WHERE ((([DDT_Picking Line].Type)=2) AND (([DDT_Picking Header].[Document Type])=0) AND (([DDT_Picking Header].Status)=0 Or ([DDT_Picking Header].Status)=1))
GROUP BY [DDT_Picking Header].[Sell-to Customer No_], [DDT_Picking Line].[Order No_], [DDT_Picking Line].[Order Line No_]
HAVING ((([DDT_Picking Header].[Sell-to Customer No_])=[FORMS]![PRINCIPALE]![FILTROCLIENTEEAN]));

