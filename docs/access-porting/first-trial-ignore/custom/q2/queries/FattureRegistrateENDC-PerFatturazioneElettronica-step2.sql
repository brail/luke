SELECT [SELL-TO CUSTOMER NO_], NAME, DocumentNo_, DataFattura, qtyInvoiced, Amount_, LineDiscountAmount, LineAmount, InvoiceDiscountAmountu,  AmountWithVAT
FROM [FattureRegistrateENDC-PerFatturazioneElettronica-step0];

UNION ALL SELECT [SELL-TO CUSTOMER NO_], NAME, DocumentNo_, DataFattura,qtyInvoiced, Amount_, LineDiscountAmount, LineAmount, InvoiceDiscountAmountu, AmountWithVAT
FROM [FattureRegistrateENDC-PerFatturazioneElettronica-step1];

