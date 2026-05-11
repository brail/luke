UPDATE [Purch_ Rcpt_ Line] SET [Purch_ Rcpt_ Line].[Buy-from Vendor No_] = "F01238", [Purch_ Rcpt_ Line].[Pay-to Vendor No_] = "F01238"
WHERE ((([Purch_ Rcpt_ Line].[Buy-from Vendor No_])="F00816") AND (([Purch_ Rcpt_ Line].[Pay-to Vendor No_])="F00816") AND (([Purch_ Rcpt_ Line].[Document No_])="ROA-21-00079" Or ([Purch_ Rcpt_ Line].[Document No_])="ROA-21-00080"));

