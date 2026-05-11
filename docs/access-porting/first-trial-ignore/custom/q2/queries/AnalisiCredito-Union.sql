SELECT CodiceCliente, Name, [Name 2], Address, [Post Code], City, County, [Country_region Code],  [VAT Registration NO_], [Fiscal Code],  [Payment Method Code], [Current Risk], DataAggiornamento, DataValutazione, DataScadenza, [Updated Type],  [Skip Credit Info Update], SaldoD, [Currency Code], ValueSoldStagione1, ValueOutStandingStagione1, ValueSoldStagione2, ValueOutStandingStagione2, ValueReturnStagione1, ValueReturnStagione2, [Purchase Group], [Risk Rating], [PM Failure Assigned Score]
FROM [AnalisiCredito-Both];

union all SELECT CodiceCliente, Name, [Name 2], Address, [Post Code], City, County, [Country_region Code],  [VAT Registration NO_], [Fiscal Code], [Payment Method Code], [Current Risk], DataAggiornamento, DataValutazione, DataScadenza, [Updated Type], [Skip Credit Info Update], SaldoD, [Currency Code], ValueSoldStagione1, ValueOutStandingStagione1, ValueSoldStagione2, ValueOutStandingStagione2, ValueReturnStagione1, ValueReturnStagione2, [Purchase Group], [Risk Rating], [PM Failure Assigned Score]
FROM [AnalisiCredito-SoloSaldo];

UNION ALL SELECT CodiceCliente, Name,[Name 2], Address, [Post Code], City, County, [Country_region Code],  [VAT Registration NO_], [Fiscal Code], [Payment Method Code], [Current Risk], DataAggiornamento, DataValutazione, DataScadenza, [Updated Type], [Skip Credit Info Update], SaldoD, [Currency Code], ValueSoldStagione1, ValueOutStandingStagione1, ValueSoldStagione2, ValueOutStandingStagione2, ValueReturnStagione1, ValueReturnStagione2, [Purchase Group], [Risk Rating], [PM Failure Assigned Score]
FROM [AnalisiCredito-SoloVendite];

