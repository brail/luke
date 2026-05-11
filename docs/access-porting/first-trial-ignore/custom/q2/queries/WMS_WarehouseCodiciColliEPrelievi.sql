SELECT [Salesperson Code], Name, [Sell-to Customer No_], [Bill-to Name], [Document No_], [Ship Provider Order ID], [Line No_], Article, ColorCode, [Assortment Code], Marchio, StagioneVendita, qty, PrelievoRegistrato, NumeroPrelievo, FasePrelievo, [Bin Code], Code, SpedWarehouseNo, [Special Requests], [Warehouse Speciality Code], [Warehouse Note], SpedWarehouseData
FROM WMS_WarehouseCodiciColliEPrelievi_step0_NonRegistrati;

UNION ALL SELECT [Salesperson Code], Name, [Sell-to Customer No_], [Bill-to Name], [Document No_],  [Ship Provider Order ID],[Line No_], Article, ColorCode, [Assortment Code], Marchio, StagioneVendita, qty, PrelievoRegistrato, NumeroPrelievo, FasePrelievo, [Bin Code], Code, SpedWarehouseNo, [Special Requests], [Warehouse Speciality Code], [Warehouse Note], SpedWarehouseData
FROM WMS_WarehouseCodiciColliEPrelievi_step1_Registrati;

