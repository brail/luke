SELECT EDI.*, TranscodificaCarryOverTH.codiceTH, TranscodificaCarryOverTH.codiceFeb, IIf(IsNull([codiceTh])=False,"XXX","") AS ATTENZIONE
FROM EDI LEFT JOIN TranscodificaCarryOverTH ON EDI.Article = TranscodificaCarryOverTH.codiceTH;

