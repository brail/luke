UPDATE [Transfer Header] INNER JOIN [Transfer Line] ON [Transfer Header].No_ = [Transfer Line].[Document No_] SET [Transfer Header].[Transfer-to Code] = "SPMAG", [Transfer Line].[Transfer-to Code] = "SPMAG"
WHERE ((([Transfer Line].[Document No_])="TRO-25/00628"));

