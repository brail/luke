SELECT Check, SH_DocType, No_, SHE_DocType, [Document No_], [Selling Season Code]
FROM [ControlloSalesHeaderEExtension-step0];

UNION ALL SELECT Check, SH_DocType, No_, SHE_DocType, [Document No_], [Selling Season Code]
FROM [ControlloSalesHeaderEExtension-step1];

UNION ALL SELECT Check, SH_DocType, No_, SHE_DocType, [Document No_], [Selling Season Code]
FROM [ControlloSalesHeaderEExtension-step2];

