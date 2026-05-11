SELECT WMS_WarehouseJournalControllo_step0.*, IIf([TEST1_ToBInAssente]="ERR" Or [TEST2_CodeAssente]="ERR" Or [TEST3_quantityDiversaDa1]="ERR","ERRGLOBAL","") AS TESTGLOBAL
FROM WMS_WarehouseJournalControllo_step0;

