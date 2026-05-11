UPDATE [Cust_ Ledger Entry] SET [Cust_ Ledger Entry].[Due Date] = #8/31/2020#
WHERE ((([Cust_ Ledger Entry].[Due Date])=#5/31/2020#) AND (([Cust_ Ledger Entry].Open)=1) AND (([Cust_ Ledger Entry].[payment method code])="RIBA"));

