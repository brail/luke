SELECT Item.No_, [Tariff Number].No_, Item.[trademark code], Item.[season code], Item.[Tariff No_]
FROM Item LEFT JOIN [Tariff Number] ON Item.[Tariff No_] = [Tariff Number].No_
WHERE ((([Tariff Number].No_) Is Null) AND ((Item.[Tariff No_])<>""));

