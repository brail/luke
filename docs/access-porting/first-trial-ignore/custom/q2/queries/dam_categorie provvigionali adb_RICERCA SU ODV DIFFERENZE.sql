SELECT [Sales Line].[commission group code], [Sales Header].[Commission Group Code], Item.[commission group code], [Sales Line].type, [Sales Header].No_, [Sales Line].No_, [Sales Header].[selling season code], [Sales Header].[Shortcut Dimension 2 Code], [Sales Line].[Subject 2 Commission _]
FROM ([Sales Line] INNER JOIN Item ON [Sales Line].No_ = Item.No_) INNER JOIN [Sales Header] ON [Sales Line].[Document No_] = [Sales Header].No_
WHERE ((([Sales Line].[commission group code])<>[item.commission group code]) AND (([Sales Line].type)=19 Or ([Sales Line].type)=20 Or ([Sales Line].type)=2) AND (([Sales Header].[selling season code])="I21") AND (([Sales Header].[Shortcut Dimension 2 Code])="BLAUER" Or ([Sales Header].[Shortcut Dimension 2 Code])="BLK"));

