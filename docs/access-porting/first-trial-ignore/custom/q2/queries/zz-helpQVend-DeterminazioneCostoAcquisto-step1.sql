SELECT [zz-helpQVend-DeterminazioneCostoAcquisto].No_, Sum([zz-helpQVend-DeterminazioneCostoAcquisto].[No_ of Pairs]) AS PurchasedPairs, Sum([zz-helpQVend-DeterminazioneCostoAcquisto].[Line Amount]) AS PurchaseAmount
FROM [zz-helpQVend-DeterminazioneCostoAcquisto]
GROUP BY [zz-helpQVend-DeterminazioneCostoAcquisto].No_;

