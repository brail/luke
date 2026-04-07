SELECT [AnalisiDateConsegna-step0].*, [receiptdate]-[plannedreceiptdate] AS DelayReceiptPlanned, [receiptdate]-[promisedreceiptdate] AS DelayReceiptPromised, [receiptdate]-[requestedreceiptdate] AS DelayReceiptRequested, IIf([delayreceiptPlanned]>14,"X","") AS DelayGT14daysPlanned, IIf([delayreceiptPlanned]>7,"X","") AS DelayGT7daysPlanned, IIf([delayreceiptPromised]>14,"X","") AS DelayGT14daysPromised, IIf([delayreceiptPromised]>7,"X","") AS DelayGT7daysPromised
FROM [AnalisiDateConsegna-step0];

UNION ALL SELECT [AnalisiDateConsegna-step0-inevase].*, [receiptdate]-[plannedreceiptdate] AS DelayReceiptPlanned, [receiptdate]-[promisedreceiptdate] AS DelayReceiptPromised, [receiptdate]-[requestedreceiptdate] AS DelayReceiptRequested, IIf([delayreceiptPlanned]>14,"X","") AS DelayGT14daysPlanned, IIf([delayreceiptPlanned]>7,"X","") AS DelayGT7daysPlanned, IIf([delayreceiptPromised]>14,"X","") AS DelayGT14daysPromised, IIf([delayreceiptPromised]>7,"X","") AS DelayGT7daysPromised
FROM [AnalisiDateConsegna-step0-inevase];

