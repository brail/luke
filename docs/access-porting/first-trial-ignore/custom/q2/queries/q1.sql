SELECT [Sales Line].No_, [Sales Line].[Document No_], [Sales Line].[Line No_], [Sales Line].[Sell-to Customer No_], Val([Quantity]) AS comprato, Val([Qty_ Shipped Not Invoiced]) AS quantitaspeditanonfatt, Val([Quantity Shipped]) AS quantitaspedita, Val([Quantity Invoiced]) AS quantitafatt
FROM [Sales Line]
WHERE ((([Sales Line].No_)="fm8sn02044" Or ([Sales Line].No_)="fm8sn02045"));

