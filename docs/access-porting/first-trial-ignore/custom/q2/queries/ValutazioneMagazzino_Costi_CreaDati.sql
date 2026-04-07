INSERT INTO ValutazioneMagazzinoTabella ( [Item No_], [Vendor No_], [MaxDiStarting Date] )
SELECT ValutazioneMagazzino_Costi_step0.[Item No_], ValutazioneMagazzino_Costi_step0.[Vendor No_], Max(ValutazioneMagazzino_Costi_step0.[Starting Date]) AS [MaxDiStarting Date]
FROM ValutazioneMagazzino_Costi_step0
GROUP BY ValutazioneMagazzino_Costi_step0.[Item No_], ValutazioneMagazzino_Costi_step0.[Vendor No_]
HAVING (((ValutazioneMagazzino_Costi_step0.[Vendor No_])="VAL A" Or (ValutazioneMagazzino_Costi_step0.[Vendor No_])="VAL B") AND ((Max(ValutazioneMagazzino_Costi_step0.[Starting Date]))<=[forms]![principale]![datafinale]))
ORDER BY ValutazioneMagazzino_Costi_step0.[Item No_], ValutazioneMagazzino_Costi_step0.[Vendor No_], Max(ValutazioneMagazzino_Costi_step0.[Starting Date]);

