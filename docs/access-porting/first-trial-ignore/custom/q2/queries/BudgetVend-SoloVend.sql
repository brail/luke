SELECT [qSoloVend-perBudget].SalesPersonCode AS SalespersonCode, [qSoloVend-perBudget].Salesperson, [qSoloVend-perBudget].CustomerCode, [qSoloVend-perBudget].CustomerName, [qSoloVend-perBudget].Trademark AS Trademark, [qSoloVend-perBudget].SeasonCode, [qSoloVend-perBudget].PairsSold, Budget.PairsBudget, [qSoloVend-perBudget].salesvalue, Budget.ValueBudget, Budget.Doors, Budget.SalespersonCode
FROM Budget RIGHT JOIN [qSoloVend-perBudget] ON (Budget.CustomerCode = [qSoloVend-perBudget].CustomerCode) AND (Budget.SalespersonCode = [qSoloVend-perBudget].SalesPersonCode) AND (Budget.Trademark = [qSoloVend-perBudget].Trademark) AND (Budget.SeasonCode = [qSoloVend-perBudget].SeasonCode)
WHERE (((Budget.SalespersonCode) Is Null));

