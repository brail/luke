SELECT CAT_1, CAT_2, [Trademark code], [Season code], [Item No_], [Location Code], qty
FROM GiacenzaLiberaVeloce_step0_GiacenzaTotale;

UNION ALL SELECT CAT_1, CAT_2, [Trademark code], [Season code], [Item No_], [Location Code], qty
FROM GiacenzaLiberaVeloce_step1_GiacenzaAssortita;

UNION ALL SELECT CAT_1, CAT_2, [Trademark code], [Season code], [Item No_], [Location Code], qty
FROM GiacenzaLiberaVeloce_step1a_GiacenzaSfusa;

UNION ALL SELECT CAT_1, CAT_2, [Trademark code], [Season code], [No_], [Location Code], -qty
FROM GiacenzaLiberaVeloce_step2_bolla;

