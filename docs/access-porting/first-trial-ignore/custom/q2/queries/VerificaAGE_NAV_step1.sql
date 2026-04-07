SELECT "AGE" AS ORIGINE, AGE_FatturazioneElettronica.[Identificativo fornitore], Sum(AGE_FatturazioneElettronica.[Imponibile/Importo (totale in euro)]) AS Importonetto, Sum(AGE_FatturazioneElettronica.[Imposta (totale in euro)]) AS imposta
FROM AGE_FatturazioneElettronica
GROUP BY "AGE", AGE_FatturazioneElettronica.[Identificativo fornitore];

