SELECT CalcoloDisponibilitaItemPerStock_pre.*, IIf([sold out]=1 Or [Potential sold out]=1,1,0) AS VenditaLimitata, IIf([sold out]=1,0,IIf([Potential sold out]=1,IIf([tosellQTY]<=0,-[tosellQTY],0),0)) AS Quantità
FROM CalcoloDisponibilitaItemPerStock_pre;

