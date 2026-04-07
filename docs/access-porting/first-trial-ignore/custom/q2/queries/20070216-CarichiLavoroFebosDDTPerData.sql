SELECT [20070216-CarichiLavoroFebosListaRigheDDT].[Posted Date], Sum([20070216-CarichiLavoroFebosListaRigheDDT].Paia) AS PaiaDDT, Count([20070216-CarichiLavoroFebosListaRigheDDT].No_) AS RigheDDT
FROM [20070216-CarichiLavoroFebosListaRigheDDT]
WHERE ((([20070216-CarichiLavoroFebosListaRigheDDT].[Posted No_])<>''))
GROUP BY [20070216-CarichiLavoroFebosListaRigheDDT].[Posted Date];

