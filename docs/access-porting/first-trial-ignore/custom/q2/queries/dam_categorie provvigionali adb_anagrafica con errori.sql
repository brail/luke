SELECT Item.[Commission Group Code], Item.[Trademark Code], Item.[Season Code], Item.No_, Item.[Configurator Relation]
FROM Item
WHERE (((Item.[Commission Group Code])<>"BL0" And (Item.[Commission Group Code])<>"BLADB") AND ((Item.[Trademark Code])="BLAUER") AND ((Item.[Season Code])="E21" Or (Item.[Season Code])="I21") AND ((Item.[Configurator Relation])=1)) OR (((Item.[Commission Group Code])<>"BLK0" And (Item.[Commission Group Code])<>"BLKDB") AND ((Item.[Trademark Code])="BLK") AND ((Item.[Season Code])="E21" Or (Item.[Season Code])="I21") AND ((Item.[Configurator Relation])=1));

