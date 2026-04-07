SELECT Customer.No_, Customer.Name, Customer.[E-Mail]
FROM [Sales Cr_Memo Header] INNER JOIN Customer ON [Sales Cr_Memo Header].[Bill-to Customer No_] = Customer.No_
WHERE ((([Sales Cr_Memo Header].No_)>="NCG-20-00001" And ([Sales Cr_Memo Header].No_)<="NCG-20-00608"))
GROUP BY Customer.No_, Customer.Name, Customer.[E-Mail]
HAVING (((Customer.[E-Mail])<>""))
ORDER BY Customer.No_;

