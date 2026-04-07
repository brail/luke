UPDATE Customer SET Customer.[Geographical Zone 2] = "34"
WHERE (((Customer.[Geographical Zone 2])<>"") AND ((Customer.[Country_Region Code])<>"SM" And (Customer.[Country_Region Code])<>"IT") AND ((Customer.Placeholder)=0));

