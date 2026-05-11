UPDATE Customer INNER JOIN [DDT_Picking Header] ON Customer.No_ = [DDT_Picking Header].[Sell-to Customer No_] SET [DDT_Picking Header].[Bill-to Address] = [CUSTOMER.ADDRESS], [DDT_Picking Header].[Bill-to Post Code] = [CUSTOMER.POST CODE], [DDT_Picking Header].[Sell-to Address] = [CUSTOMER.ADDRESS], [DDT_Picking Header].[Sell-to Post Code] = [CUSTOMER.POST CODE]
WHERE (((Customer.No_)="C08259") AND (([DDT_Picking Header].[SELLING SEASON CODE])="I24") AND (([DDT_Picking Header].status)<>20));

