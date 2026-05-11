UPDATE [Purch_ Rcpt_ Header] SET [Purch_ Rcpt_ Header].[Buy-from Vendor No_] = "F01238", [Purch_ Rcpt_ Header].[Pay-to Vendor No_] = "F01238"
WHERE ((([Purch_ Rcpt_ Header].[Buy-from Vendor No_])="F00816") AND (([Purch_ Rcpt_ Header].[Pay-to Vendor No_])="F00816") AND (([Purch_ Rcpt_ Header].No_)="ROA-21-00079" Or ([Purch_ Rcpt_ Header].No_)="ROA-21-00080"));

