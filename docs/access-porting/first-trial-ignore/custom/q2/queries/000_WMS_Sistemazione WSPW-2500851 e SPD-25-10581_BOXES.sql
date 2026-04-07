UPDATE [Unique Identifier Pst_ Docnts] INNER JOIN [Item Identifier] ON [Unique Identifier Pst_ Docnts].Code = [Item Identifier].Code SET [Item Identifier].Status = 2
WHERE ((([Unique Identifier Pst_ Docnts].No_)="WPWR-2501053"));

