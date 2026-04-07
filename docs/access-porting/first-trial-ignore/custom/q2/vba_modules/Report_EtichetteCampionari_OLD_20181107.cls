Option Compare Database

Private Sub Report_Open(Cancel As Integer)
    Dim res1 As String
    res1 = InputBox("Inserire marchio BP=BePositive AP=Apepazza BL=Blauer")
    Dim RES As Integer
    RES = MsgBox("Split per articolo colore", vbYesNo)
    If RES = 6 Then
        Me.IntestazioneGruppo0.ForceNewPage = 1
    Else
        Me.IntestazioneGruppo0.ForceNewPage = 0
    End If
    If res1 = "BL" Then
        LogoBlauer.Visible = True
        LogoBePositive.Visible = False
        logoApepazza.Visible = False
    ElseIf res1 = "AP" Then
        LogoBlauer.Visible = False
        LogoBePositive.Visible = False
        logoApepazza.Visible = True
    ElseIf res1 = "BP" Then
        LogoBlauer.Visible = False
        LogoBePositive.Visible = True
        logoApepazza.Visible = False
    Else
        LogoBlauer.Visible = False
        LogoBePositive.Visible = False
        logoApepazza.Visible = False
    End If
End Sub