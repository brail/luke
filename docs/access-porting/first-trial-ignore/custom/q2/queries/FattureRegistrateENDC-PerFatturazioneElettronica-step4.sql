SELECT FattureInviateIndicom.[N# documento], Max(FattureInviateIndicom.[Data creazione]) AS UtlimaDataCreazione
FROM FattureInviateIndicom
GROUP BY FattureInviateIndicom.[N# documento];

