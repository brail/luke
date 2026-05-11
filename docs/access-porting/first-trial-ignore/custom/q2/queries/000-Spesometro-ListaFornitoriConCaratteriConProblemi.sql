SELECT Vendor.No_, Vendor.Name, Vendor.[Name 2], Vendor.Address
FROM Vendor
WHERE (((Vendor.Name) Like "%°%" Or (Vendor.Name) Like "%&%")) OR (((Vendor.[Name 2]) Like "%°%" Or (Vendor.[Name 2]) Like "%&%")) OR (((Vendor.Address) Like "%°%" Or (Vendor.Address) Like "%&%"));

