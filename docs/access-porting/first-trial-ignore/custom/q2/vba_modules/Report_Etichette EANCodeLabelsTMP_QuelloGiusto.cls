Option Compare Database

Private Sub Corpo_Format(Cancel As Integer, FormatCount As Integer)

    On Error GoTo err_gest
    
    GoTo fine
err_gest:
    If Err = 2220 Then
        ' MsgBox Err.Number & " " & Err.Description
        Resume Next
    End If
    MsgBox "report aborted with error " & Err.Number & " " & Err.Description
    'Resume Next
fine:
End Sub

Private Sub Report_Open(Cancel As Integer)
    Dim RES As Integer
    RES = MsgBox("Split per articolo colore", vbYesNo)
    If RES = 6 Then
        Me.IntestazioneGruppo0.ForceNewPage = 1
    Else
        Me.IntestazioneGruppo0.ForceNewPage = 0
    End If
    
End Sub