SELECT SalespersonCode,Salesperson, CustomerCode, CustomerName, Trademark, SeasonCode, PairsSold, PairsBudget, SalesValue,ValueBudget, Doors
FROM [BudgetVend-Both];

union all SELECT SalespersonCode,Salesperson, CustomerCode, CustomerName, Trademark, SeasonCode, 0, PairsBudget, 0,ValueBudget, Doors
FROM [BudgetVend-SoloBudget];

UNION ALL SELECT SalespersonCode,Salesperson, CustomerCode, CustomerName, Trademark, SeasonCode, PairsSold, 0, SalesValue,0, 0
FROM [BudgetVend-SoloVend];

