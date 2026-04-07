SELECT CalcoloDisponibilita_pre.*, IIf([sold out]=1 Or [Potential sold out]=1,1,0) AS VenditaLimitata, IIf([sold out]=1,0,IIf([Potential sold out]=1,IIf([tosellQTY]<=0,-[tosellQTY],0),0)) AS Quantità, IIf([sold out]=1,0,IIf([Potential sold out]=1,IIf([tosellQTY_CrossSeason]<=0,-[tosellQTY_CrossSeason],0),0)) AS Quantità_CrossSeason
FROM CalcoloDisponibilita_pre;

