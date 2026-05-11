UPDATE [000_WMS_PBM_table_rIGHE cARICO DA CANCELLARE] INNER JOIN [Item Ledger Entry] ON [000_WMS_PBM_table_rIGHE cARICO DA CANCELLARE].[Item Rcpt_ Entry No_] = [Item Ledger Entry].[Entry No_] SET [Item Ledger Entry].[Document No_] = [Item Ledger Entry.Document No_] & "_";

