SELECT [20070216-CarichiLavoroFebosListaRigheOrdiniDiVendita].[Season Code], [20070216-CarichiLavoroFebosListaRigheOrdiniDiVendita].[Trademark Code], Sum([20070216-CarichiLavoroFebosListaRigheOrdiniDiVendita].Paia) AS Paia, Count([20070216-CarichiLavoroFebosListaRigheOrdiniDiVendita].[Line No_]) AS RigheOrdini
FROM [20070216-CarichiLavoroFebosListaRigheOrdiniDiVendita]
GROUP BY [20070216-CarichiLavoroFebosListaRigheOrdiniDiVendita].[Season Code], [20070216-CarichiLavoroFebosListaRigheOrdiniDiVendita].[Trademark Code];

