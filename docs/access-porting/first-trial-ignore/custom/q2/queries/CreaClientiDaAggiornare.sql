SELECT Customer.No_, Customer.Name, Customer.[Country_Region Code], Customer.[Geographical Zone 2], IIf([country_region code]="ES" Or [country_region code]="XB","134",IIf([country_region code]="SM","1","135")) AS [NEW Customer Price Group], Customer.[Customer Price Group] INTO ClientiDaAggiornare
FROM Customer
WHERE (((Customer.[Geographical Zone 2])="34"));

