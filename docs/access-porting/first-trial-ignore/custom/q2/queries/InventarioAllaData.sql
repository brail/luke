SELECT [InventarioAllaData-step0].*, (IIf(IsNull([valutazionemagazzino_costi.ITEM NO_])=False,Val([PAIA])*[costo],0)) AS Valore, (IIf(IsNull([valutazionemagazzino_costi.ITEM NO_])=True,"MANCA","")) AS TESTMANCANTE, [forms]![principale]![datafinale] AS DataValutazione
FROM [InventarioAllaData-step0] LEFT JOIN ValutazioneMagazzino_Costi ON ([InventarioAllaData-step0].CodiceFonitorePerPrezzo = ValutazioneMagazzino_Costi.[Vendor No_]) AND ([InventarioAllaData-step0].[Item No_] = ValutazioneMagazzino_Costi.[Item No_]);

