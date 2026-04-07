Option Compare Database
Option Explicit



Sub ImpostaProprietaAvvio()
    If dbg = False Then
        'ModificaProprieta "StartupForm", dbText, "Clienti"
        ModificaProprieta "StartupShowDBWindow", dbBoolean, False
        ModificaProprieta "StartupShowStatusBar", dbBoolean, True
        ModificaProprieta "AllowBuiltinToolbars", dbBoolean, True
        'Consentiti full menus per consentire elaborazione dei grafici pivot
        'ModificaProprieta "AllowFullMenus", dbBoolean, False
        ModificaProprieta "AllowBreakIntoCode", dbBoolean, False
        ModificaProprieta "AllowSpecialKeys", dbBoolean, True
        ' messo consentito sempre bypass key
        ModificaProprieta "AllowBypassKey", dbBoolean, True
    End If
  

End Sub

Sub consentiBypass()
    ModificaProprieta "AllowBypassKey", dbBoolean, True
End Sub

Function ModificaProprieta(strNomeProp As String, varTipoProp As Variant, varValoreProp As Variant) As Integer
    Dim dbs As Database
    ' attenzione dao.property
    Dim prp As DAO.Property
    Const conErroreProprietaNonTrovata = 3270

    Set dbs = CurrentDb
    On Error GoTo Modifica_Err
    dbs.Properties(strNomeProp) = varValoreProp
    ModificaProprieta = True

Modifica_Bye:
    Exit Function

Modifica_Err:
    If Err = conErroreProprietaNonTrovata Then  ' Proprieta non trovata.
Set prp = dbs.CreateProperty(strNomeProp, varTipoProp, varValoreProp)
        dbs.Properties.append prp
        Resume Next
    Else
        ' Errore sconosciuto.
        ModificaProprieta = False
        Resume Modifica_Bye
    End If
End Function