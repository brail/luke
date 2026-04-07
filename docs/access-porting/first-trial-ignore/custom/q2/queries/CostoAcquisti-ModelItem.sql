SELECT CostiAcquisti.[Model Item No_], Avg(CostiAcquisti.Costo) AS Costo, CostiAcquisti.[Variable Code 01]
FROM CostiAcquisti
GROUP BY CostiAcquisti.[Model Item No_], CostiAcquisti.[Variable Code 01];

