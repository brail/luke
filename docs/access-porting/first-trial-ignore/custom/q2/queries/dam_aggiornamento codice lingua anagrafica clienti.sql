UPDATE Customer SET Customer.[Language Code] = "ENU"
WHERE (((Customer.[Language Code])="") AND ((Customer.[Country_Region Code])<>"IT") AND ((Customer.Placeholder)=0));

