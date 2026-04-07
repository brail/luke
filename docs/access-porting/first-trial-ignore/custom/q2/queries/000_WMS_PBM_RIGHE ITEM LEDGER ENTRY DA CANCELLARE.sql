SELECT [Item Ledger Entry].*, Val([Quantity]) AS qty
FROM [000_WMS_PBM_table_rIGHE cARICO DA CANCELLARE] INNER JOIN [Item Ledger Entry] ON [000_WMS_PBM_table_rIGHE cARICO DA CANCELLARE].[Item Rcpt_ Entry No_] = [Item Ledger Entry].[Entry No_];

