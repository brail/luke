SELECT "NAV" AS ORIGINE, "'" & [IDCODICEf] & "'" AS IDCODICECONAPICI, [FE Header].IdCodiceF, [FE Header].CodiceFiscaleF, [FE Header].DenominazioneF, [FE Header].NomeF, [FE Header].CognomeF, Sum(Val([ImportoTotaleDocumento])) AS Importo
FROM [FE Header]
GROUP BY "NAV", "'" & [IDCODICEf] & "'", [FE Header].IdCodiceF, [FE Header].CodiceFiscaleF, [FE Header].DenominazioneF, [FE Header].NomeF, [FE Header].CognomeF;

