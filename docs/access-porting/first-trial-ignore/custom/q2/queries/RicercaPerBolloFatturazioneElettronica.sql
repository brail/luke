SELECT 2 AS DOCTYPE, [Bill-to Name], No_, Type, [VAT Identifier], [posting date], Importo, [currency code]
FROM [RicercaPerBolloFatturazioneElettronica-step0-fatture]

UNION ALL SELECT 3 AS DOCTYPE, [Bill-to Name], No_, Type, [VAT Identifier], [posting date], -Importo, [currency code]
FROM [RicercaPerBolloFatturazioneElettronica-step0-ndc];

