SELECT [FattureRegistrateENDC-PerFatturazioneElettronica-step2].*, [FE Document].*
FROM [FattureRegistrateENDC-PerFatturazioneElettronica-step2] LEFT JOIN [FE Document] ON [FattureRegistrateENDC-PerFatturazioneElettronica-step2].DocumentNo_ = [FE Document].[Document No_];

