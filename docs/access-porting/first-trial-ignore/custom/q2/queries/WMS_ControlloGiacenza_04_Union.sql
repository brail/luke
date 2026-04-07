SELECT "1_NAV_STD" AS InventoryType, [Location Code], [Model Item No_] AS Article, [Constant Variable Code] AS Color, [Assortment Code], [Bin Code], Code, qty
FROM WMS_ControlloGiacenza_01_NavStd;

union all SELECT "2_NAV_WHSE" AS InventoryType, [Location Code], [Item No_], [Constant Variable Code],[Assortment Code], [Bin Code], "", qty
FROM WMS_ControlloGiacenza_02_NavWhse;

UNION ALL SELECT "3_NAV_BOXES" AS InventoryType, [Location Code], [Item No_], [Constant Variable Code],[Assortment Code], [Bin Code], Code, 1 
FROM WMS_ControlloGiacenza_03_NavItemIdentifier;

