Option Compare Database

Private Sub Report_Open(Cancel As Integer)
    Dim res1 As String
    res1 = InputBox("Inserire marchio AP=Apepazza AA=AqvaAlta BP=BePositive BL=Blauer RW=Refrigiwear SD=Save The Duck (EX NP=Napapijri PE=Pejo ST=Starwin)  (Diverso = No Logo)")
    Dim RES As Integer
    RES = MsgBox("Split per articolo colore", vbYesNo)
    If RES = 6 Then
        Me.IntestazioneGruppo0.ForceNewPage = 1
    Else
        Me.IntestazioneGruppo0.ForceNewPage = 0
    End If
    logoApepazza.Visible = False
    logoAquaAlta.Visible = False
    LogoBePositive.Visible = False
    LogoBlauer.Visible = False
    LogoRefrigiwear.Visible = False
    logoSaveTheDuck.Visible = False
    
    logoNapa.Visible = False
    logoPejo.Visible = False
    logoStarwin.Visible = False
    
    If res1 = "AP" Then
        logoApepazza.Visible = True
    ElseIf res1 = "AA" Then
        Me.logoAquaAlta.Visible = True
    ElseIf res1 = "BP" Then
        LogoBePositive.Visible = True
    ElseIf res1 = "BL" Then
        LogoBlauer.Visible = True
    ElseIf res1 = "RW" Then
        LogoRefrigiwear.Visible = True
    ElseIf res1 = "SD" Then
        logoSaveTheDuck.Visible = True
    ElseIf res1 = "NP" Then
        logoNapa.Visible = True
    ElseIf res1 = "PE" Then
        logoPejo.Visible = True
    ElseIf res1 = "ST" Then
        logoStarwin.Visible = True
    Else
        
    End If
End Sub