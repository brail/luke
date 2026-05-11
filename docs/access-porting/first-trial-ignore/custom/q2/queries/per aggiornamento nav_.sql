SELECT [per aggiornamento NAV].CustomerCode, [per aggiornamento NAV].[SPECIALITA'], [per aggiornamento NAV].Lunghezza, IIf(Len([Special Requests])>0,[Special Requests],"") AS [Special Requests_]
FROM [per aggiornamento NAV];

