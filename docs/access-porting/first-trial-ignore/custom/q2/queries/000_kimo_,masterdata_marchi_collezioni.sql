SELECT Item.[Trademark Code], Item.[Season Code], Item.[Collection Code]
FROM Item
GROUP BY Item.[Trademark Code], Item.[Season Code], Item.[Collection Code]
HAVING (((Item.[Season Code])="E21"))
ORDER BY Item.[Trademark Code], Item.[Collection Code];

