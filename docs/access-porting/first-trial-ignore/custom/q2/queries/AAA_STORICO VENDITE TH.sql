SELECT Item.[trademark code], Item.[season code], Sum(Val([no_ of pairs])) AS qty, Sum(Val([AMOUNT])) AS VAL
FROM (Item INNER JOIN [Sales Line] ON Item.No_ = [Sales Line].No_) INNER JOIN [Sales Header] ON [Sales Line].[Document No_] = [Sales Header].No_
WHERE ((([Sales Line].type)=19 Or ([Sales Line].type)=20) AND (([Sales Line].[Document Type])=1))
GROUP BY Item.[trademark code], Item.[season code]
HAVING (((Item.[trademark code])="TH"));

