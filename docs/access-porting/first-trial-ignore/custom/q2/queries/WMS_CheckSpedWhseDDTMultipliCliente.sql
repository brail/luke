SELECT WMS_CheckSpedWhseDDTMultipliCliente_Step01.No_, WMS_CheckSpedWhseDDTMultipliCliente_Step01.[Warehouse Note], [DDT_Picking Header].[Sell-to Customer No_], [DDT_Picking Header].[Ship-to Code], Count([DDT_Picking Header].No_) AS ConteggioDiNo_
FROM [DDT_Picking Header] INNER JOIN WMS_CheckSpedWhseDDTMultipliCliente_Step01 ON [DDT_Picking Header].No_ = WMS_CheckSpedWhseDDTMultipliCliente_Step01.[Source No_]
GROUP BY WMS_CheckSpedWhseDDTMultipliCliente_Step01.No_, WMS_CheckSpedWhseDDTMultipliCliente_Step01.[Warehouse Note], [DDT_Picking Header].[Sell-to Customer No_], [DDT_Picking Header].[Ship-to Code]
HAVING (((Count([DDT_Picking Header].No_))>1));

