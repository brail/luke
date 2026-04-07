UPDATE [Transfer Line] INNER JOIN [Transfer Header] ON [Transfer Line].[Document No_] = [Transfer Header].No_ SET [Transfer Header].[In-Transit Code] = "1CN_DBG", [Transfer Line].[In-Transit Code] = "1CN_DBG", [Transfer Header].[Transfer-to Code] = "DBG", [Transfer Line].[Transfer-to Code] = "DBG"
WHERE ((([Transfer Header].[In-Transit Code])="1CN_PMAG") AND (([Transfer Line].[In-Transit Code])="1CN_PMAG") AND (([Transfer Header].[Transfer-to Code])="PMAG") AND (([Transfer Line].[Transfer-to Code])="PMAG") AND (([Transfer Header].No_)="TRO-23/00627") AND ((Val([quantity shipped]))>0));

