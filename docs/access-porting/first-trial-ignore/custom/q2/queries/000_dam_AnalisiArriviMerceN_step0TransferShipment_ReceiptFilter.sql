SELECT [000_dam_AnalisiArriviMerceN_step0_TransferReceipt].[Transfer Order No_], Sum([000_dam_AnalisiArriviMerceN_step0_TransferReceipt].QTY) AS QTY
FROM 000_dam_AnalisiArriviMerceN_step0_TransferReceipt
GROUP BY [000_dam_AnalisiArriviMerceN_step0_TransferReceipt].[Transfer Order No_];

