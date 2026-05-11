SELECT q2.[Sell-to Customer No_], Count(q2.No_) AS ConteggioDiNo_
FROM q2
GROUP BY q2.[Sell-to Customer No_]
HAVING (((Count(q2.No_))>1));

