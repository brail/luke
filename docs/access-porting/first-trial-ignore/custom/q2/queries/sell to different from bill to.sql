SELECT [Sales Header].No_, [Sales Header].[Bill-to Customer No_], [Sales Header].[Bill-to Name], [Sales Header].[Bill-to Address], [Sales Header].[Bill-to City], [Sales Header].[Bill-to Post Code], [Sales Header].[Sell-to Customer No_], [Sales Header].[Sell-to Customer Name], [Sales Header].[Sell-to Address], [Sales Header].[Sell-to City], [Sales Header].[Sell-to Post Code]
FROM [Sales Header]
WHERE ((([Sales Header].[Bill-to Customer No_])<>[Sell-to Customer No_])) OR ((([Sales Header].[Bill-to Name])<>[Sell-to Customer Name])) OR ((([Sales Header].[Bill-to Address])<>[Sell-to Address])) OR ((([Sales Header].[Bill-to City])<>[Sell-to City])) OR ((([Sales Header].[Bill-to Post Code])<>[Sell-to Post Code]));

