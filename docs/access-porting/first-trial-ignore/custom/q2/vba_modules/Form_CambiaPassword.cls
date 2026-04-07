Option Compare Database
Option Explicit

Private Sub Form_Activate()
    Utente.Value = nomeUtente
    Vecchia.Value = ""
    Nuova.Value = ""
    Verifica.Value = ""
    
End Sub

Private Sub TastoCambia_Click()
    Dim rst As DAO.Recordset
    Dim currPwd
    ' 1. verifica che le nuove password siano uguali e diverse da ""
    If (Verifica.Value <> Nuova.Value) Then
        MsgBox "La password nuova deve essere uguale a quella verificata"
        Exit Sub
    End If
    If (Nuova.Value = "") Then
        MsgBox "La password nuova deve essere non vuota"
        Exit Sub
    End If
    ' 2. verifica che la vecchia password sia corretta
    Set rst = CurrentDb.OpenRecordset("SELECT * FROM UTENTI WHERE account='" & nomeUtente & "'")
    If rst.RecordCount > 0 Then
        currPwd = rst!Password
        If Vecchia.Value <> currPwd Then
            MsgBox "La vecchia password non corrisponde"
        Else
            ' 3. cambia password
            rst.Edit
            rst!Password = Nuova.Value
            rst.Update
            MsgBox "Password aggiornata per " & Utente.Value
        End If
    Else
        MsgBox "Utente attivo non presente in tabella"
        Exit Sub
    End If
    rst.Close

End Sub

Private Sub TastoRitorna_Click()
    DoCmd.Close
End Sub