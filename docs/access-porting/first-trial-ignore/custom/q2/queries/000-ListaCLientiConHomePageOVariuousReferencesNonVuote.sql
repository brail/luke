SELECT Customer.No_, Customer.Name, Customer.[Home Page], Customer.[Various References]
FROM Customer
WHERE (((Customer.[Home Page])<>'')) OR (((Customer.[Various References])<>''));

