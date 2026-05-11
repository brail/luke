SELECT [20070216-CarichiLavoroFebosListaRigheOrdiniDiVendita].[Document Date], Sum([20070216-CarichiLavoroFebosListaRigheOrdiniDiVendita].Paia) AS PaiaOrdini, Count([20070216-CarichiLavoroFebosListaRigheOrdiniDiVendita].[Line No_]) AS RigheOrdini
FROM [20070216-CarichiLavoroFebosListaRigheOrdiniDiVendita]
GROUP BY [20070216-CarichiLavoroFebosListaRigheOrdiniDiVendita].[Document Date];

