SELECT Customer.No_, Customer.Name, Customer.[Name 2], Customer.Address
FROM Customer
WHERE (((Customer.Name) Like "%°%" Or (Customer.Name) Like "%&%")) OR (((Customer.[Name 2]) Like "%°%" Or (Customer.[Name 2]) Like "%&%")) OR (((Customer.Address) Like "%°%" Or (Customer.Address) Like "%&%"));

