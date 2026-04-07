SELECT [AnalisiDateConsegnaVendite-step0].*, [deliverydate]-[promiseddeliverydate] AS DelayDeliveryPromised, [deliverydate]-[requesteddeliverydate] AS DelayDeliveryRequested, IIf([DelayDeliveryPromised]>14,"X","") AS DelayGT14daysPromised, IIf([DelayDeliveryPromised]>7,"X","") AS DelayGT7daysPromised, IIf([delayDeliveryRequested]>14,"X","") AS DelayGT14daysRequested, IIf([delayDeliveryRequested]>7,"X","") AS DelayGT7daysRequested
FROM [AnalisiDateConsegnaVendite-step0];

UNION ALL SELECT [AnalisiDateConsegnaVendite-step0-inevase].*, [deliverydate]-[promiseddeliverydate] AS DelayDeliveryPromised, [deliverydate]-[requesteddeliverydate] AS DelayDeliveryRequested, IIf([DelayDeliveryPromised]>14,"X","") AS DelayGT14daysPromised, IIf([DelayDeliveryPromised]>7,"X","") AS DelayGT7daysPromised, IIf([delayDeliveryRequested]>14,"X","") AS DelayGT14daysRequested, IIf([delayDeliveryRequested]>7,"X","") AS DelayGT7daysRequested
FROM [AnalisiDateConsegnaVendite-step0-inevase];

