SELECT [SituazioneSpedizioniCliente-step1].*, [SituazioneSpedizioniCliente-step0].status, [SituazioneSpedizioniCliente-step0].SPD_No, [SituazioneSpedizioniCliente-step0].[posting date], [SituazioneSpedizioniCliente-step0].qty AS pairsready
FROM [SituazioneSpedizioniCliente-step0] INNER JOIN [SituazioneSpedizioniCliente-step1] ON [SituazioneSpedizioniCliente-step0].[Order No_] = [SituazioneSpedizioniCliente-step1].[Document No_];

