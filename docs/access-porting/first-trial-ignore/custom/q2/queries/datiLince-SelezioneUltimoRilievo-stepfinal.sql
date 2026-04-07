SELECT [datiLince-SelezioneUltimoRilievo-step0].[Rif#], [datiLince-SelezioneUltimoRilievo-step0].DataEvasione AS LinceDataEvasione, Max(datiLince.[Rischio Oggi]) AS LinceRischioOggi
FROM [datiLince-SelezioneUltimoRilievo-step0] INNER JOIN datiLince ON ([datiLince-SelezioneUltimoRilievo-step0].[Rif#] = datiLince.[Rif#]) AND ([datiLince-SelezioneUltimoRilievo-step0].DataEvasione = datiLince.[Evaso il])
GROUP BY [datiLince-SelezioneUltimoRilievo-step0].[Rif#], [datiLince-SelezioneUltimoRilievo-step0].DataEvasione
HAVING (((Max(datiLince.[Rischio Oggi]))<>""));

