SELECT [000_dam_calcolo ddt misti_step 0].[Document No_], [000_dam_calcolo ddt misti_step 0].[Sell-to Customer No_], [000_dam_calcolo ddt misti_step 0].[Bill-to Name], [000_dam_calcolo ddt misti_step 0].TrademarkCode, [000_dam_calcolo ddt misti_step 0].CCR, [000_dam_calcolo ddt misti_step 0].[Selling Season Code], Count([000_dam_calcolo ddt misti_step 0].Type) AS ConteggioDiType, Sum([000_dam_calcolo ddt misti_step 0].paia) AS paia
FROM [000_dam_calcolo ddt misti_step 0]
GROUP BY [000_dam_calcolo ddt misti_step 0].[Document No_], [000_dam_calcolo ddt misti_step 0].[Sell-to Customer No_], [000_dam_calcolo ddt misti_step 0].[Bill-to Name], [000_dam_calcolo ddt misti_step 0].TrademarkCode, [000_dam_calcolo ddt misti_step 0].CCR, [000_dam_calcolo ddt misti_step 0].[Selling Season Code]
HAVING ((([000_dam_calcolo ddt misti_step 0].[Selling Season Code])="I24") AND ((Count([000_dam_calcolo ddt misti_step 0].Type))=2))
ORDER BY [000_dam_calcolo ddt misti_step 0].CCR, Sum([000_dam_calcolo ddt misti_step 0].paia) DESC;

