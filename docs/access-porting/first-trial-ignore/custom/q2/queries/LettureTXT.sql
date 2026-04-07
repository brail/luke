SELECT ListaPerSovraccolluDaLetture.CARTONE, IIf(Len([eancodelettore])=13,Format$([eancodelettore],"0000000000000"),Format$([eancodelettore],"000000000000")) AS EANCODELETTORETXT
FROM ListaPerSovraccolluDaLetture;

