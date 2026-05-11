SELECT [Bill-to Customer No_], [Bill-to Name], Importo, [selling season code], Marchio, TIPO
FROM BLAUER_covid_2a_FATTURE;

UNION ALL SELECT [Bill-to Customer No_], [Bill-to Name], -Importo, [selling season code], Marchio, TIPO
FROM BLAUER_covid_2b_NDC;

