SELECT [Document No_],IMPORTO, "PdC" AS source
FROM [000-Stefania-ControlloFatturatoEContoEconomica-step0];

UNION ALL SELECT  [No_], IMPORTO, "FATT" AS source
FROM [000-Stefania-ControlloFatturatoEContoEconomica-step1];

