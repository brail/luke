SELECT [FattureRegistrateENDC-PerFatturazioneElettronica-step3].*, [FE SDI Log].[Indicom Received Date], [FE SDI Log].[SDI Send Date and Time], [FE SDI Log].[SDI Get Date and Time], [FE SDI Log].[Technical Status], [FE SDI Log].[Error Message], [FE SDI Log].[Document Status]
FROM [FattureRegistrateENDC-PerFatturazioneElettronica-step3] LEFT JOIN [FE SDI Log] ON [FattureRegistrateENDC-PerFatturazioneElettronica-step3].[File Name XML] = [FE SDI Log].[XML File Name];

