Option Compare Database
Option Explicit

Private Sub Form_Open(Cancel As Integer)
    ImpostaProprietaAvvio
End Sub

Private Sub TastoAvvia_Click()


    Dim ute As String
    Dim pwd As String
    
    If IsNull(controlloutente.Value) = False Then
        ute = controlloutente.Value
    Else
        ute = ""
    End If
    If IsNull(controllopassword.Value) = False Then
        pwd = controllopassword.Value
    Else
        pwd = ""
    End If
    ' AAAA TOGLIERE
    'ModificaProprieta "StartupShowDBWindow", dbBoolean, True
    ' AAAA TOGLIERE
        ModificaProprieta "StartupShowStatusBar", dbBoolean, True
    ' superadmin login
    If ute = "aoe2iavng" And pwd = "irhanvwbas" Then
        MsgBox "Ready to go"
        consentiBypass
        Exit Sub
    End If
    
    livelloUtente = verificautente(ute, pwd)
    nomeUtente = ute
    
    ' determinazione azienda
    Dim rstTmp As DAO.Recordset
    Set rstTmp = CurrentDb.OpenRecordset("select * from [company information]")
    rstTmp.MoveFirst
    If Left$(rstTmp!Name, 5) = "FEBOS" Then
        nomeAzienda = "FEBOS"
    Else
        nomeAzienda = "BRIDGE"
    End If
    rstTmp.Close
    
    ' dalla versione 19.0 cablato a "NewEra"
    nomeAzienda = "NewEra"
    
    If livelloUtente >= 0 Then
        DoCmd.OpenForm ("Principale")
        Forms("Principale").nomeAccount.Caption = ute
        Forms("Principale").livelloAccount.Caption = livelloUtente
        Forms("Principale").nomeCompany.Caption = nomeAzienda
        DoCmd.Close acForm, Me.Name
    End If
    
    'per visualizzare il navigation pane
    'DoCmd.SelectObject acTable, , True
    
End Sub

Private Function verificautente(u As String, p As String)
    Dim rst As DAO.Recordset
    Dim RES As Integer
    RES = -1
    Set rst = CurrentDb.OpenRecordset("Select * from utenti where account='" & u & "' and password='" & p & "'")
    If rst.RecordCount <> 1 Then
        RES = -1
    Else
        If IsNull(rst!livello) = False Then
            RES = rst!livello
        Else
            RES = -1
        End If
    End If
    rst.Close
    verificautente = RES
End Function
Private Sub TastoEsci_Click()
    fineProgramma
End Sub