SELECT WMS_TestOUTPRE_Diverso_SpedWhse_step02.*, WMS_TestOUTPRE_Diverso_SpedWhse_step01.No_, WMS_TestOUTPRE_Diverso_SpedWhse_step01.Prel_qty, IIf([prel_qty]<>[whsh_qty],"ERR","") AS TEST
FROM WMS_TestOUTPRE_Diverso_SpedWhse_step02 INNER JOIN WMS_TestOUTPRE_Diverso_SpedWhse_step01 ON WMS_TestOUTPRE_Diverso_SpedWhse_step02.No_ = WMS_TestOUTPRE_Diverso_SpedWhse_step01.[Whse_ Document Ref_ No_];

