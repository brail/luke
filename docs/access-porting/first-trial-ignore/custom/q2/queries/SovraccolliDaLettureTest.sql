SELECT Count([SovraccolliDaLettureTest-step0].Cartone) AS CartoniContati, Sum([SovraccolliDaLettureTest-step0].SommaDiPezzi) AS pezziTotali, Max(Val([cartone])) AS numeromaxcartone
FROM [SovraccolliDaLettureTest-step0];

