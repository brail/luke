SELECT [Cross-Reference Model Item].[Model Item No_], [Cross-Reference Model Item].[Constant Variable Code], [Cross-Reference Model Item].[Cross-Reference No_], TRANSCODIFICAFGF.MODELLO, TRANSCODIFICAFGF.PARTE, TRANSCODIFICAFGF.COLORE_FGF, TRANSCODIFICAFGF.ColorCode, [Cross-Reference Model Item].[Cross-Reference Type]
FROM TRANSCODIFICAFGF LEFT JOIN [Cross-Reference Model Item] ON (TRANSCODIFICAFGF.ColorCode = [Cross-Reference Model Item].[Constant Variable Code]) AND (TRANSCODIFICAFGF.NO_ = [Cross-Reference Model Item].[Model Item No_])
WHERE ((([Cross-Reference Model Item].[Cross-Reference Type])=1));

