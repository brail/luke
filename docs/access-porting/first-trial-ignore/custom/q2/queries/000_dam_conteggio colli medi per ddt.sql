SELECT [000_dam_conteggio colli medi per ddt_step0].[Selling Season Code], [000_dam_conteggio colli medi per ddt_step0].NumeroColli, Count([000_dam_conteggio colli medi per ddt_step0].[Document No_]) AS NumeroDocumenti
FROM [000_dam_conteggio colli medi per ddt_step0]
GROUP BY [000_dam_conteggio colli medi per ddt_step0].[Selling Season Code], [000_dam_conteggio colli medi per ddt_step0].NumeroColli;

