UPDATE [000_WMS_PBM_table_rIGHE cARICO DA CANCELLARE] INNER JOIN [Value Entry] ON [000_WMS_PBM_table_rIGHE cARICO DA CANCELLARE].[Item Rcpt_ Entry No_] = [Value Entry].[Item Ledger Entry No_] SET [Value Entry].[Document No_] = [Value Entry.Document No_] & "_";

