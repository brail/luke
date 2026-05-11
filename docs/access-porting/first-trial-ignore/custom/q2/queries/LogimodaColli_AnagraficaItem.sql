SELECT Item.[Model Item No_], Item.[Variable Code 01], Item.[Variable Group 01], Item.[Variable Group 02], Item.[Selling Season Code], Item.[Model Code], Item.[Collection Code], Item.[Season Code], Item.[Line Code], Item.[Brand Code]
FROM Item
WHERE (((Item.[Configurator Relation])=3))
GROUP BY Item.[Model Item No_], Item.[Variable Code 01], Item.[Variable Group 01], Item.[Variable Group 02], Item.[Selling Season Code], Item.[Model Code], Item.[Collection Code], Item.[Season Code], Item.[Line Code], Item.[Brand Code]
HAVING (((Item.[Season Code])="E22" Or (Item.[Season Code])="E23" Or (Item.[Season Code])="E24" Or (Item.[Season Code])="E25" Or (Item.[Season Code])="I22" Or (Item.[Season Code])="I23" Or (Item.[Season Code])="I24" Or (Item.[Season Code])="I25"));

