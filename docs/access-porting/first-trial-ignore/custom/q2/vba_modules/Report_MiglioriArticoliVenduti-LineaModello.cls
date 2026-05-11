Option Compare Database
Option Explicit

Private Sub Corpo_Format(Cancel As Integer, FormatCount As Integer)
    On Error GoTo err_gest
    
    If Forms!principale.FlagMostraFornitore = True Then
        Me.VendorNameControl.Visible = True
        Me.ManufacturerNameControl.Visible = True
    Else
        Me.VendorNameControl.Visible = False
        Me.ManufacturerNameControl.Visible = False
    End If
   
    If Forms!principale.FlagMostraQuantita = True Then
        Me.EtichettaPaia.Visible = True
        Me.PaiaSKU.Visible = True
        Me.PaiaArticolo.Visible = True
        Me.PaiaLinea.Visible = True
        Me.PaiaTotali.Visible = True
    Else
        Me.EtichettaPaia.Visible = False
        Me.PaiaSKU.Visible = False
        Me.PaiaArticolo.Visible = False
        Me.PaiaLinea.Visible = False
        Me.PaiaTotali.Visible = False
    End If
        If Forms!principale.FlagMostraListino = True Then
        Me.ListRetail.Visible = True
        Me.ListWholesale.Visible = True
    Else
        Me.ListRetail.Visible = False
        Me.ListWholesale.Visible = False
    End If

    If Me.ControlloPercorsoImmagine <> "" Then
        Me.Fotografia.Visible = True
        Me.Fotografia.Picture = Me.ControlloPercorsoImmagine
    Else
        Me.Fotografia.Visible = False
    End If
    If IsNull(Me.ControlloPercorsoImmagine) = False Then
        Me.Fotografia.Picture = Me.ControlloPercorsoImmagine
    End If

GoTo end_sub
err_gest:
    MsgBox Err.Description
end_sub:
End Sub