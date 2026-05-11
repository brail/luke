SELECT [ControlloGiacenzaPaiaLibere-step3_pre].*, (IIf(IsNull([ControlloGiacenzaPaiaLibere-step3_Bolla.NO_]),0,[QTY_BOLLA])) AS paiaBOLLA
FROM [ControlloGiacenzaPaiaLibere-step3_pre] LEFT JOIN [ControlloGiacenzaPaiaLibere-step3_Bolla] ON ([ControlloGiacenzaPaiaLibere-step3_pre].[Location Code] = [ControlloGiacenzaPaiaLibere-step3_Bolla].[Location Code]) AND ([ControlloGiacenzaPaiaLibere-step3_pre].[Item No_] = [ControlloGiacenzaPaiaLibere-step3_Bolla].No_);

