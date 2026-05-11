UPDATE [Sales Line] INNER JOIN Item ON [Sales Line].No_ = Item.No_ SET [Sales Line].[Model Item No_] = [ITEM.Model Item No_]
WHERE ((([Sales Line].[Model Item No_])<>[ITEM.Model Item No_]));

