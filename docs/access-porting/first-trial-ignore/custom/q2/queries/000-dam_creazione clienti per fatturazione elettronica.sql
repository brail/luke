INSERT INTO [Customer Recipient Relation] ( [Customer No_], [Recipient Code], [FE Starting Date Service], [FE Ending Date Service], [Invoicing PEC], [Export Transport Information], [Export Tracking Information] )
SELECT Customer.No_, "0000000" AS Espr1, #12/18/2018# AS Espr2, #12/18/2018# AS Espr6, "" AS Espr3, 1 AS Espr4, 0 AS Espr5
FROM Customer;

