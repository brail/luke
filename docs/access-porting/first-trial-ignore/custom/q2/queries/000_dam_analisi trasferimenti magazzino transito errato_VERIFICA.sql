SELECT [Transfer Header].No_, [Transfer Header].[Transfer-from Code], [Transfer Header].[In-Transit Code], [Transfer Header].[Transfer-to Code], [Transfer Line].[Item No_], [Transfer Line].[Transfer-from Code], [Transfer Line].[In-Transit Code], [Transfer Line].[Transfer-to Code], [Transfer Line].[Line Type], [Transfer Line].[Item Type], Val([Quantity]) AS qty, Val([Quantity Shipped]) AS qtyshp
FROM [Transfer Line] INNER JOIN [Transfer Header] ON [Transfer Line].[Document No_] = [Transfer Header].No_
WHERE ((([Transfer Header].No_)="TRO-23/00730" Or ([Transfer Header].No_)="TRO-23/00694" Or ([Transfer Header].No_)="TRO-23/00627"));

