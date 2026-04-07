UPDATE [Purch_ Rcpt_ Header] INNER JOIN [Purch_ Rcpt_ Line] ON [Purch_ Rcpt_ Header].No_ = [Purch_ Rcpt_ Line].[Document No_] SET [Purch_ Rcpt_ Line].[posting date] = #1/6/2020#, [Purch_ Rcpt_ Header].[posting date] = #1/6/2020#
WHERE ((([Purch_ Rcpt_ Line].[Document No_])="ROA-19-00479"));

