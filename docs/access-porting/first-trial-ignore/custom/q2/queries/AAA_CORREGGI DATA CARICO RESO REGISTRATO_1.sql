UPDATE [Return Receipt Line] INNER JOIN [Return Receipt Header] ON [Return Receipt Line].[Document No_] = [Return Receipt Header].No_ SET [Return Receipt Line].[posting date] = #11/14/2024#, [Return Receipt Header].[posting date] = #11/14/2024#
WHERE ((([Return Receipt Line].[Document No_])="CAR-RES-VE-24/01530"));

