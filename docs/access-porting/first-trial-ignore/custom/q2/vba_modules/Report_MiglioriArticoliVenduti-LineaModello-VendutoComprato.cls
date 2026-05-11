Option Compare Database
Option Explicit

Private Sub Corpo_Format(Cancel As Integer, FormatCount As Integer)
    On Error GoTo err_gest
    
    If Me.ControlloPercorsoImmagine <> "" Then
        Me.Fotografia.Visible = True
        Me.Fotografia.Picture = Me.ControlloPercorsoImmagine
    Else
        Me.Fotografia.Visible = False
    End If
GoTo end_sub
err_gest:
    MsgBox Err.Description
end_sub:
End Sub