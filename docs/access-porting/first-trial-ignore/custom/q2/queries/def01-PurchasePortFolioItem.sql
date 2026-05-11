SELECT qSoloAcqItem.*, [DB Suole BePositive].[CODICE SUOLA], [DB Suole BePositive].[COLORE SUOLA]
FROM qSoloAcqItem LEFT JOIN [DB Suole BePositive] ON (qSoloAcqItem.Color = [DB Suole BePositive].Color) AND (qSoloAcqItem.[Model Item No_] = [DB Suole BePositive].[Model Item No_]);

