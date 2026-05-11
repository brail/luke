Option Compare Database

Private Sub IntestazioneGruppo0_Format(Cancel As Integer, FormatCount As Integer)
    If Forms!principale!FlagMostraReferenze = True Then
        Me.CustOrdRef.Visible = True
        Me.CustOrdRefLab.Visible = True
        Me.Ref.Visible = True
        Me.RefLab.Visible = True
    Else
        Me.CustOrdRef.Visible = False
        Me.CustOrdRefLab.Visible = False
        Me.Ref.Visible = False
        Me.RefLab.Visible = False
    End If
End Sub