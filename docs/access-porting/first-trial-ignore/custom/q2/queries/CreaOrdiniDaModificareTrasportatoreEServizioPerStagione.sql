SELECT Customer.[Geographical Zone 2], [Sales Header].NO_ AS [Document No_], [Sales Header].[Selling Season Code], [Sales Header].[Shortcut Dimension 1 Code] AS CCR, [Sales Header].[Shortcut Dimension 2 Code] AS Trademark, IIf([trademark]="TH" Or [trademark]="NAPA" Or [trademark]="THK","1","2") AS CodSpedizioniere, IIf([trademark]="TH" Or [trademark]="NAPA" Or [trademark]="THK","C",IIf([geographical zone 2]="34","48N","NC")) AS CodServizio INTO OrdiniDaModificare
FROM [Sales Header] INNER JOIN Customer ON [Sales Header].[Sell-to Customer No_] = Customer.No_
WHERE ((([Sales Header].[Selling Season Code])="I1819"));

