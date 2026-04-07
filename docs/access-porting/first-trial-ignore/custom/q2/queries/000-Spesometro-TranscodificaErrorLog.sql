SELECT [Comm_ Dati Error Log].*, Vendor.No_, Vendor.Name
FROM ([Comm_ Dati Error Log] INNER JOIN [VAT Entry] ON [Comm_ Dati Error Log].[Entry No_] = [VAT Entry].[Entry No_]) INNER JOIN Vendor ON [VAT Entry].[Bill-to_Pay-to No_] = Vendor.No_
ORDER BY [Comm_ Dati Error Log].[Entry No_];

