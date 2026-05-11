Option Compare Database

Private Sub Corpo_Format(Cancel As Integer, FormatCount As Integer)
If Me.qty_label.Value = 0 Then
    Me.tagliaeuropea_label.Visible = False
    Me.qty_label.Visible = False
    Me.EAN_BARCODE_LABEL.Visible = False
    Me.UPC_BARCODE_LABEL.Visible = False
Else
    Me.tagliaeuropea_label.Visible = True
    Me.qty_label.Visible = True
    If Forms!principale!FlagEtichettaUPC_StampeMagazzino = True Then
        Me.EAN_BARCODE_LABEL.Visible = False
        Me.UPC_BARCODE_LABEL.Visible = True
    Else
        Me.EAN_BARCODE_LABEL.Visible = True
        Me.UPC_BARCODE_LABEL.Visible = False
    End If
End If

End Sub

Private Sub IntestazioneGruppo0_Format(Cancel As Integer, FormatCount As Integer)
    If Forms!principale!FlagMostraReferenze = True Then
        'Me.CustOrdRef.Visible = True
        'Me.CustOrdRefLab.Visible = True
        'Me.Ref.Visible = True
        'Me.RefLab.Visible = True
    Else
        'Me.CustOrdRef.Visible = False
        'Me.CustOrdRefLab.Visible = False
        'Me.Ref.Visible = False
        'Me.RefLab.Visible = False
    End If
End Sub