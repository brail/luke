SELECT Item.[Variable Code 01]
FROM Item
WHERE (((Item.[model item No_])=[forms]![principale]![item_control]) AND ((Item.[Sales_Purchase Status - Item])=""))
GROUP BY Item.[Variable Code 01]
ORDER BY Item.[Variable Code 01];

