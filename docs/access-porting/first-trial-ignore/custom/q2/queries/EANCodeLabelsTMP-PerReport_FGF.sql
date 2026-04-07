SELECT EANCodeLabelsTMP.*, ImmaginiPerEtichetteScatola.[Linked Document], Item.[Line Code], TRANSCODIFICAFGF.Description_FGF
FROM ((EANCodeLabelsTMP LEFT JOIN ImmaginiPerEtichetteScatola ON (EANCodeLabelsTMP.Color = ImmaginiPerEtichetteScatola.[Constant Variable Code]) AND (EANCodeLabelsTMP.Article = ImmaginiPerEtichetteScatola.[Source No_])) LEFT JOIN Item ON EANCodeLabelsTMP.Article = Item.No_) LEFT JOIN TRANSCODIFICAFGF ON (EANCodeLabelsTMP.Color = TRANSCODIFICAFGF.colorcode) AND (EANCodeLabelsTMP.Article = TRANSCODIFICAFGF.NO_);

