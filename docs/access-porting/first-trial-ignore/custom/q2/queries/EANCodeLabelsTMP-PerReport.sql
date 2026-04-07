SELECT EANCodeLabelsTMP.*, ImmaginiPerEtichetteScatola.[Linked Document], Item.[Line Code]
FROM (EANCodeLabelsTMP LEFT JOIN ImmaginiPerEtichetteScatola ON (EANCodeLabelsTMP.Color = ImmaginiPerEtichetteScatola.[Constant Variable Code]) AND (EANCodeLabelsTMP.Article = ImmaginiPerEtichetteScatola.[Source No_])) LEFT JOIN Item ON EANCodeLabelsTMP.Article = Item.No_;

