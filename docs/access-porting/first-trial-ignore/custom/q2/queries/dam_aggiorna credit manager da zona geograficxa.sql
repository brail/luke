UPDATE Customer INNER JOIN [Geographical Zone] ON Customer.[Geographical Zone] = [Geographical Zone].Code SET Customer.[Credit Manager] = [Geographical Zone.Credit Manager];

