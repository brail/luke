SELECT AssortimentiQuantita.[Assortment Code], First(AssortimentiQuantita.AssortmentQuantity) AS AssortmentQuantity
FROM AssortimentiQuantita
GROUP BY AssortimentiQuantita.[Assortment Code];

