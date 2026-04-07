SELECT Budget.SalespersonCode AS SalespersonCode, Budget.SalesPerson, Budget.CustomerCode, Budget.CustomerName, Budget.Trademark, Budget.SeasonCode, [qSoloVend-perBudget].PairsSold, Budget.PairsBudget, [qSoloVend-perBudget].salesvalue, Budget.ValueBudget, Budget.Doors, [qSoloVend-perBudget].SalesPersonCode
FROM Budget LEFT JOIN [qSoloVend-perBudget] ON (Budget.Trademark = [qSoloVend-perBudget].Trademark) AND (Budget.SeasonCode = [qSoloVend-perBudget].SeasonCode) AND (Budget.CustomerCode = [qSoloVend-perBudget].CustomerCode) AND (Budget.SalespersonCode = [qSoloVend-perBudget].SalesPersonCode)
WHERE ((([qSoloVend-perBudget].SalesPersonCode) Is Null));

