SELECT ListaPerSovraccolluDaLetture.CARTONE, Format$([EANCODELETTORE],"000000000000") AS EANCODELETTORETXT, Count(ListaPerSovraccolluDaLetture.EANCODELETTORE) AS Pezzi
FROM ListaPerSovraccolluDaLetture
GROUP BY ListaPerSovraccolluDaLetture.CARTONE, Format$([EANCODELETTORE],"000000000000");

