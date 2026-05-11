-- Extracted: 2025-09-24T15:16:49.016896

-- Form_~TMPCLP64331:3-26
/* Private Sub Comando2_Click */
Private Sub Comando2_Click()
    Dim oItem As Variant
    Dim sTemp As String
    Dim iCount As Integer
    
    iCount = 0
            
    If Me!Elenco0.ItemsSelected.count <> 0 Then
        For Each oItem In Me!Elenco0.ItemsSelected
            If iCount = 0 Then
                sTemp = sTemp & Me!Elenco0.ItemData(oItem)
                iCount = iCount + 1
            Else
                sTemp = sTemp & "," & Me!Elenco0.ItemData(oItem)
                iCount = iCount + 1
            End If
        Next oItem
    Else
        MsgBox "Nothing was selected from the list", vbInformation
        Exit Sub  'Nothing was selected
    End If
    
    Debug.Print sTemp
End Sub

GO

-- Form_CambiaPassword:4-10
/* Private Sub Form_Activate */
Private Sub Form_Activate()
    Utente.Value = nomeUtente
    Vecchia.Value = ""
    Nuova.Value = ""
    Verifica.Value = ""
    
End Sub

GO

-- Form_CambiaPassword:12-43
/* Private Sub TastoCambia_Click */
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

GO

-- Form_CambiaPassword:45-47
/* Private Sub TastoRitorna_Click */
Private Sub TastoRitorna_Click()
    DoCmd.Close
End Sub

GO

-- Form_Login:4-6
/* Private Sub Form_Open */
Private Sub Form_Open(Cancel As Integer)
    ImpostaProprietaAvvio
End Sub

GO

-- Form_Login:8-63
/* Private Sub TastoAvvia_Click */
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

GO

-- Form_Login:65-81
/* Private Function verificautente */
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

GO

-- Form_Login:82-84
/* Private Sub TastoEsci_Click */
Private Sub TastoEsci_Click()
    fineProgramma
End Sub

GO

-- Form_Principale:3-15
/* Sub sistemaquerysolostagionaleepronto */
Sub sistemaquerysolostagionaleepronto()
    Dim qdf1 As QueryDef, qdf2 As QueryDef
    If Me.FlagSoloOrdineStagionaleEPronto.Value = True Then
        Set qdf1 = CurrentDb.QueryDefs("GraficoMiglioriArticoliVenduti-step0")
        Set qdf2 = CurrentDb.QueryDefs("GraficoMiglioriArticoliVenduti-step0-SoloStagionaleEPronto")
        qdf1.SQL = qdf2.SQL
    Else
        Set qdf1 = CurrentDb.QueryDefs("GraficoMiglioriArticoliVenduti-step0")
        Set qdf2 = CurrentDb.QueryDefs("GraficoMiglioriArticoliVenduti-step0-TuttiGliOrdini")
        qdf1.SQL = qdf2.SQL
    End If

End Sub

GO

-- Form_Principale:16-64
/* Sub sistemaFiltroStagioneMarchioLogimoda */
Sub sistemaFiltroStagioneMarchioLogimoda()
    Dim oItem As Variant
    Dim TempStagioneFiltro As String
    Dim TempStagioneNomeFile As String
    Dim TempMarchioFiltro As String
    Dim TempMarchioNomeFile As String
    
    Dim iCount As Integer
    
    iCount = 0
    TempStagioneFiltro = ""
    TempStagioneNomeFile = ""
    If Me!FiltroStagioneLogimoda.ItemsSelected.count <> 0 Then
        For Each oItem In Me.FiltroStagioneLogimoda.ItemsSelected
        
            If iCount = 0 Then
                TempStagioneFiltro = TempStagioneFiltro & "[Item.Season Code]='" & Me!FiltroStagioneLogimoda.ItemData(oItem) & "'"
                TempStagioneNomeFile = TempStagioneNomeFile & Me!FiltroStagioneLogimoda.ItemData(oItem)
                iCount = iCount + 1
            Else
                TempStagioneFiltro = TempStagioneFiltro & " or [Item.Season Code]='" & Me!FiltroStagioneLogimoda.ItemData(oItem) & "'"
                TempStagioneNomeFile = TempStagioneNomeFile & "-" & Me!FiltroStagioneLogimoda.ItemData(oItem)
                iCount = iCount + 1
            End If
        Next oItem
    End If
    
    iCount = 0
    TempMarchioFiltro = ""
    TempMarchioNomeFile = ""
    If Me!FiltroMarchioLogimoda.ItemsSelected.count <> 0 Then
        For Each oItem In Me.FiltroMarchioLogimoda.ItemsSelected
        
            If iCount = 0 Then
                TempMarchioFiltro = TempMarchioFiltro & "[Item.Trademark Code]='" & Me!FiltroMarchioLogimoda.ItemData(oItem) & "'"
                TempMarchioNomeFile = TempMarchioNomeFile & Me!FiltroMarchioLogimoda.ItemData(oItem)
                iCount = iCount + 1
            Else
                TempMarchioFiltro = TempMarchioFiltro & " or [Item.Trademark Code]='" & Me!FiltroMarchioLogimoda.ItemData(oItem) & "'"
                TempMarchioNomeFile = TempMarchioNomeFile & "-" & Me!FiltroMarchioLogimoda.ItemData(oItem)
                iCount = iCount + 1
            End If
        Next oItem
    End If
    
    Me.FiltroStagioneMarchioCalcolato = " (" & TempStagioneFiltro & ") and (" & TempMarchioFiltro & ")"
    Me.FiltroStagioneMarchioPerNomeFile = TempStagioneNomeFile & "_" & TempMarchioNomeFile
    
End Sub

GO

-- Form_Principale:65-114
/* Sub sistemaFiltroStagioneMarchio */
Sub sistemaFiltroStagioneMarchio()
    Dim oItem As Variant
    Dim TempStagioneFiltro As String
    Dim TempStagioneNomeFile As String
    Dim TempMarchioFiltro As String
    Dim TempMarchioNomeFile As String
    
    Dim iCount As Integer
    
    iCount = 0
    TempStagioneFiltro = ""
    TempStagioneNomeFile = ""
    If Me!FiltroStagioneMultiSelezione.ItemsSelected.count <> 0 Then
        For Each oItem In Me.FiltroStagioneMultiSelezione.ItemsSelected
        
            If iCount = 0 Then
                TempStagioneFiltro = TempStagioneFiltro & "[Season Code]='" & Me!FiltroStagioneMultiSelezione.ItemData(oItem) & "'"
                TempStagioneNomeFile = TempStagioneNomeFile & Me!FiltroStagioneMultiSelezione.ItemData(oItem)
                iCount = iCount + 1
            Else
                TempStagioneFiltro = TempStagioneFiltro & " or [Season Code]='" & Me!FiltroStagioneMultiSelezione.ItemData(oItem) & "'"
                TempStagioneNomeFile = TempStagioneNomeFile & "-" & Me!FiltroStagioneMultiSelezione.ItemData(oItem)
                iCount = iCount + 1
            End If
        Next oItem
    End If
    
    iCount = 0
    TempMarchioFiltro = ""
    TempMarchioNomeFile = ""
    ' il marchio non consente multiselezione quindi va gestito in modo diverso dalla stagione
    Dim i As Integer
    For i = 0 To Me.FiltroMarchioMultiSelezione.ListCount - 1
        Debug.Print Me!FiltroMarchioMultiSelezione.ItemData(i)
        If Me.FiltroMarchioMultiSelezione.Selected(i) = True Then
            Debug.Print Me!FiltroMarchioMultiSelezione.ItemData(i) & " is selected"
            TempMarchioFiltro = TempMarchioFiltro & "[Trademark Code]='" & Me!FiltroMarchioMultiSelezione.ItemData(i) & "'"
            TempMarchioNomeFile = TempMarchioNomeFile & Me!FiltroMarchioMultiSelezione.ItemData(i)
        End If
    Next
    
    If FiltroMarchioTipo = 1 Then 'singolo marchio
        Me.FiltroStagioneMarchioCalcolato = " (" & TempStagioneFiltro & ") and (" & TempMarchioFiltro & ")"
        Me.FiltroStagioneMarchioPerNomeFile = TempStagioneNomeFile & "_" & TempMarchioNomeFile
    Else
        Me.FiltroStagioneMarchioCalcolato = " (" & TempStagioneFiltro & ") "
        Me.FiltroStagioneMarchioPerNomeFile = TempStagioneNomeFile
    End If

End Sub

GO

-- Form_Principale:116-182
/* Private Sub EstrazioneStatisticheGenericaPerStagione */
Private Sub EstrazioneStatisticheGenericaPerStagione(nomeQuery As String, nomefile As String, condizione As String)
    ' AAA inserire controllo su numero record
    ' serve accelerarlo e basarlo sul querydef dinamico
    ' Dim rst As DAO.Recordset
    ' Dim cnt As Long
    ' Set rst = CurrentDb.OpenRecordset("def01-ANALISIVENDUTOITEM-PIVOT")
    ' rst.MoveLast
    ' cnt = rst.RecordCount
    ' MsgBox cnt
    ' If cnt > 65536 Then
    '    MsgBox "Attenzione numero eccessivo di record da esportare. Rivolgersi all'amministratore del sistema"
    '    Exit Sub
    ' End If

    ' ATTENZIONE
    ' NON USARE FILTRI CONTEMPORANEI IN AND SU CAMPI DIVERSI CHE PREVEDANO CONDIZIONI OR
    ' I TEMPI CRESCONO VERTICALMENTE
    ' (STAGIONE=A OR STAGIONE=B) AND (MARCHIO=C OR MARCHIO=D)
    
    ' verifica che almeno una stagione sia selezionata
    If Me.FiltroStagioneMultiSelezione.ItemsSelected.count = 0 Then
        MsgBox "Selezionare almeno una stagione"
        Exit Sub
    End If

    ' verifica che un marchio sia selezionato, se la modalità è marchio singolo
    If Me.FiltroMarchioTipo = 1 Then 'singolo marchio
        Dim i As Integer
        Dim contato As Integer
        contato = 0
        For i = 0 To Me.FiltroMarchioMultiSelezione.ListCount - 1
            If Me.FiltroMarchioMultiSelezione.Selected(i) = True Then contato = contato + 1
        Next
        If contato = 0 Then
            MsgBox "Selezionare un marchio"
            Exit Sub
        End If
    End If
    
    sistemaFiltroStagioneMarchio

    Dim qdfTemp As QueryDef
    Dim qdfTempName As String
    qdfTempName = Now
    Set qdfTemp = CurrentDb.CreateQueryDef(qdfTempName)
    qdfTemp.SQL = CurrentDb.QueryDefs(nomeQuery).SQL
    'rimozione ";"
    qdfTemp.SQL = Left$(qdfTemp.SQL, InStr(qdfTemp.SQL, ";") - 1)
    'aggiunta filtro stagione e marchio (where o having)
    qdfTemp.SQL = qdfTemp.SQL & " " & condizione & " " & Forms!principale.FiltroStagioneMarchioCalcolato
    
    ' in caso si debba esportare senza filtri; usato per check portafoglio acquisti durante merge / porting
    ' qdfTemp.SQL = qdfTemp.SQL
    DoCmd.Hourglass True

    Dim exportFileName As String
    exportFileName = nomeAzienda & "-" & nomefile & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00") & "-(" & FiltroStagioneMarchioPerNomeFile & ")"
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, qdfTemp.Name, exportFileName, True
    
    CurrentDb.QueryDefs.Delete qdfTemp.Name
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"


End Sub

GO

-- Form_Principale:192-195
/* Private Sub Comando6_Click */
Private Sub Comando6_Click()
    DoCmd.OpenQuery "union", acViewNormal, acReadOnly

End Sub

GO

-- Form_Principale:200-202
/* Private Sub Comando658_Click */
Private Sub Comando658_Click()

End Sub

GO

-- Form_Principale:204-228
/* Private Sub EstraiEANCliente_Click */
Private Sub EstraiEANCliente_Click()
    DoCmd.Hourglass True
    ' inserire almeno filtro stagione di vendita e cliente altrimenti
    ' i dati diventano eccessivi
    If IsNull(Me.FiltroStagioneEAN2) Or Me.FiltroStagioneEAN2 = "" Then
        MsgBox "Inserire filtro Stagione di Vendita"
        Exit Sub
    End If
    If IsNull(Me.FiltroClienteEAN) Or Me.FiltroClienteEAN = "" Then
        MsgBox "Inserire filtro Cliente"
        Exit Sub
    End If
    
    CurrentDb.Execute "delete from saleslinetmp"
    
    Dim qdf As QueryDef
    Set qdf = CurrentDb.QueryDefs("CreaRigheSalesLineTMPFiltroClienteStagione")
    qdf.Parameters("[Forms]![Principale]![FiltroClienteEan]") = Me.FiltroClienteEAN
    qdf.Parameters("[Forms]![Principale]![FiltroStagioneEan2]") = Me.FiltroStagioneEAN2
    qdf.Execute
    ' non eseguibile va in errore per too few parameters
    'CurrentDb.Execute "CreaRigheSalesLineTMPFiltroClienteStagione"
    DoCmd.OpenQuery "NavisionEAN-Cliente", acViewNormal, acReadOnly
    DoCmd.Hourglass False
End Sub

GO

-- Form_Principale:232-234
/* Private Sub filtroAgentePerGrigliaAgenti_AfterUpdate */
Private Sub filtroAgentePerGrigliaAgenti_AfterUpdate()
    Me.nomeagentenascosto = Me.filtroAgentePerGrigliaAgenti.Text
End Sub

GO

-- Form_Principale:237-244
/* Private Sub FiltroMarchioTipo_AfterUpdate */
Private Sub FiltroMarchioTipo_AfterUpdate()
    If Me.FiltroMarchioTipo = 1 Then
        Me.FiltroMarchioMultiSelezione.Enabled = True
    Else
        Me.FiltroMarchioMultiSelezione.Enabled = False
    End If

End Sub

GO

-- Form_Principale:247-250
/* Private Sub filtroODAEAN_AfterUpdate */
Private Sub filtroODAEAN_AfterUpdate()
    Me.filtrolineaean.Requery
    
End Sub

GO

-- Form_Principale:252-256
/* Private Sub Item_Control_AfterUpdate */
Private Sub Item_Control_AfterUpdate()
    Me.Color_Control.Value = ""
    Me.Color_Control.Requery

End Sub

GO

-- Form_Principale:258-275
/* Private Sub NumeroOdvTJXManuali_AfterUpdate */
Private Sub NumeroOdvTJXManuali_AfterUpdate()
    Dim rstOrig As DAO.Recordset
    Set rstOrig = CurrentDb.OpenRecordset("SELECT [Sales Line].[Document NO_], [Sales Line].[Customer Order Ref_], [Sales Line].Reference FROM [Sales Line] where  [Document No_]='" & Me.NumeroOdvTJXManuali & "' GROUP BY [Sales Line.Document NO_],[Sales Line].[Customer Order Ref_], [Sales Line].Reference")
    
    If rstOrig.RecordCount <> 1 Then
        MsgBox "Attenzione Ricerca non possibile"
        Exit Sub
    End If
        
    
    Me.NumeroOdVManuali = rstOrig![Document No_]
    Me.ReferenzaOrdine = rstOrig!Reference
    Me.RiferimentoOrdine = rstOrig![Customer Order ref_]
    
    rstOrig.Close


End Sub

GO

-- Form_Principale:277-310
/* Private Sub NumeroSPD_AfterUpdate */
Private Sub NumeroSPD_AfterUpdate()
    If NumeroSPD = "" Then Exit Sub
    Dim rstOrig As DAO.Recordset
    Dim rstOrig1 As DAO.Recordset
    Dim rstOrig2 As DAO.Recordset
    Set rstOrig = CurrentDb.OpenRecordset("select * from [DDT_Picking Header] where No_='" & Me.NumeroSPD & "'")
    Set rstOrig1 = CurrentDb.OpenRecordset("select * from [DDT_Picking Line] where [Document No_]='" & Me.NumeroSPD & "'")
    Set rstOrig2 = CurrentDb.OpenRecordset("select * from [Sales Line] where  [Document No_]='" & rstOrig1![Order no_] & "' and [Line No_]=" & rstOrig1![Order line no_] & " and (type=19 or type=20)")
    Me.ReferenzaOrdine = rstOrig2!Reference
    Me.RiferimentoOrdine = rstOrig2![Customer Order ref_]
    rstOrig2.Close
    rstOrig1.Close
    Me.numeroBPR = rstOrig![No_]
    Me.CodiceCliente = rstOrig![Bill-to Customer No_]
    Me.DescrizioneCliente1 = rstOrig![Bill-to Name]
    Me.DescrizioneCliente2 = rstOrig![Bill-to Name 2]
    Me.IndirizzoCliente1 = rstOrig![Bill-to Address]
    Me.IndirizzoCliente2 = rstOrig![Bill-to Address 2]
    Me.CapCliente = rstOrig![Bill-to Post Code]
    Me.CittaCliente = rstOrig![Bill-to City]
    Me.ProvinciaCliente = rstOrig![Bill-to County]
    Me.PaeseCliente = rstOrig![Bill-to Country_Region Code]
    Me.CodiceDestino = rstOrig![Ship-to Code]
    Me.DescrizioneDestino1 = rstOrig![Ship-to Name]
    Me.DescrizioneDestino2 = rstOrig![Ship-to Name 2]
    Me.IndirizzoDestino1 = rstOrig![Ship-to Address]
    Me.IndirizzoDestino2 = rstOrig![Ship-to Address 2]
    Me.CapDestino = rstOrig![Ship-to Post Code]
    Me.CittaDestino = rstOrig![Ship-to City]
    Me.ProvinciaDestino = rstOrig![Ship-to County]
    Me.PaeseDestino = rstOrig![Ship-to Country_Region Code]
    rstOrig.Close
    DoCmd.OpenQuery "numerospd_referenze", acViewNormal, acReadOnly
End Sub

GO

-- Form_Principale:312-368
/* Private Sub TastiEstrazioneProiezioneVendutoComprato_Click */
Private Sub TastiEstrazioneProiezioneVendutoComprato_Click()
    If Me.FiltroMarchioSourcing = "" Or IsNull(Me.FiltroMarchioSourcing) = True Or Me.FiltroStagioneSourcing = "" Or IsNull(Me.FiltroStagioneSourcing) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    
    Dim RES As Integer
    RES = MsgBox("Attenzione. Attività da svolgere un utente per volta. Ricordare anche di verificare i parametri di proiezione. Procedere?", vbYesNo)
    
    If RES <> 6 Then Exit Sub
    DoCmd.Hourglass True
    ' cancellazione dati nella tabella
    CurrentDb.Execute "delete from vendutocompratoproiezionetabella"
    ' accodamento record
    Dim qdf As QueryDef
    Set qdf = CurrentDb.QueryDefs("vendutocompratoproiezione")
    qdf.Parameters("FiltroMarchioVendutoComprato") = Me.FiltroMarchioSourcing
    qdf.Parameters("FiltroStagioneVendutoComprato") = Me.FiltroStagioneSourcing
    qdf.Execute

    ' rimozione eventuali righe duplicate
    
    Dim rst As DAO.Recordset
    Dim rst_canc As DAO.Recordset
    Set rst = CurrentDb.OpenRecordset("select * from VendutoCompratoProiezioneTabella_Duplicati")
    If rst.RecordCount > 0 Then
        rst.MoveFirst
        While rst.EOF = False
            Set rst_canc = CurrentDb.OpenRecordset("select * from VendutoCompratoProiezioneTabella where no_='" & rst!No_campo & "' and colorcode='" & rst!colorcodecampo & "'")
            If rst_canc.RecordCount > 0 Then
                ' il primo viene tenuto; vengono cancellati tutti gli eventuali altri
                rst_canc.MoveLast
                rst_canc.MoveFirst
                rst_canc.MoveNext
                While rst_canc.EOF = False
                    rst_canc.Delete
                    rst_canc.MoveNext
                Wend
            End If
            rst.MoveNext
        Wend
    End If
    ' estrazione tabella
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-VendutoCompratoProiezione-(" & Me.FiltroStagioneSourcing & "_" & Me.FiltroMarchioSourcing & ")-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "VendutoCompratoProiezioneTabella", exportFileName, True

    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

    DoCmd.OpenReport "MiglioriArticoliVenduti-LineaModello-VendutoComprato", acViewPreview

    ' EstrazioneStatisticheGenericaPerStagione "VendutoCompratoProiezione", "VendutoCompratoProiezione", "where"
    DoCmd.Hourglass False
End Sub

GO

-- Form_Principale:370-427
/* Private Sub TastiEstrazioneProiezioneVendutoCompratoItem_Click */
Private Sub TastiEstrazioneProiezioneVendutoCompratoItem_Click()
    If Me.FiltroMarchioSourcing = "" Or IsNull(Me.FiltroMarchioSourcing) = True Or Me.FiltroStagioneSourcing = "" Or IsNull(Me.FiltroStagioneSourcing) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    
    Dim RES As Integer
    RES = MsgBox("Attenzione. Attività da svolgere un utente per volta. Ricordare anche di verificare i parametri di proiezione. Procedere?", vbYesNo)
    
    If RES <> 6 Then Exit Sub
    DoCmd.Hourglass True
    ' cancellazione dati nella tabella
    CurrentDb.Execute "delete from vendutocompratoproiezionetabella"
    ' accodamento record
    Dim qdf As QueryDef
    Set qdf = CurrentDb.QueryDefs("vendutocompratoproiezioneItem")
    qdf.Parameters("FiltroMarchioVendutoComprato") = Me.FiltroMarchioSourcing
    qdf.Parameters("FiltroStagioneVendutoComprato") = Me.FiltroStagioneSourcing
    qdf.Execute

    ' rimozione eventuali righe duplicate
    
    Dim rst As DAO.Recordset
    Dim rst_canc As DAO.Recordset
    Set rst = CurrentDb.OpenRecordset("select * from VendutoCompratoProiezioneTabella_Duplicati")
    If rst.RecordCount > 0 Then
        rst.MoveFirst
        While rst.EOF = False
            Set rst_canc = CurrentDb.OpenRecordset("select * from VendutoCompratoProiezioneTabella where no_='" & rst!No_campo & "' and colorcode='" & rst!colorcodecampo & "'")
            If rst_canc.RecordCount > 0 Then
                ' il primo viene tenuto; vengono cancellati tutti gli eventuali altri
                rst_canc.MoveLast
                rst_canc.MoveFirst
                rst_canc.MoveNext
                While rst_canc.EOF = False
                    rst_canc.Delete
                    rst_canc.MoveNext
                Wend
            End If
            rst.MoveNext
        Wend
    End If
    ' estrazione tabella
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-VendutoCompratoProiezioneItem-(" & Me.FiltroStagioneSourcing & "_" & Me.FiltroMarchioSourcing & ")-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "VendutoCompratoProiezioneTabella", exportFileName, True

    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

    DoCmd.OpenReport "MiglioriArticoliVenduti-LineaModello-VendutoComprato", acViewPreview

    ' EstrazioneStatisticheGenericaPerStagione "VendutoCompratoProiezione", "VendutoCompratoProiezione", "where"
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:429-442
/* Private Sub Tasto_estraiBidone_Click */
Private Sub Tasto_estraiBidone_Click()
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-BidoneAssortimento-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "KimoBidone_SoloAssortimento", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:444-457
/* Private Sub Tasto_WMS_Controllo_SPD_MultiplePerClienteInSpedWarehouse_Click */
Private Sub Tasto_WMS_Controllo_SPD_MultiplePerClienteInSpedWarehouse_Click()
    DoCmd.Hourglass True
    
    ' estrazione tabella
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-WMS_CheckSpedWhseDDTMultipliCliente-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "WMS_CheckSpedWhseDDTMultipliCliente", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:459-468
/* Private Sub TastoAggionraDisponibileKimo_Click */
Private Sub TastoAggionraDisponibileKimo_Click()
    Dim RES As Integer
    RES = MsgBox("Attenzione vuoi procedere con aggiornamento disponibile a Kimo?", vbYesNo)
    If RES = 6 Then
        CurrentDb.Execute "AggiornaDisponibilitaKimo"
        MsgBox "aggiornamento completato"
    End If

    
End Sub

GO

-- Form_Principale:470-510
/* Private Sub TastoAggiornaLinks_Click */
Private Sub TastoAggiornaLinks_Click()
    If livelloUtente >= 3 Then
        Dim RES As Integer
        Dim res1 As Boolean
        Dim res2 As Integer
        If SelectedCompany.Value < 0 Or Me.SelectedCompany > 6 Then
            MsgBox "selezionare un'azienda"
            Exit Sub
        End If
        RES = MsgBox("Aggiornare i links", vbYesNo)
        If RES = 6 Then
            If Me.SelectedCompany = 1 Then 'Febos
                collegaTabelle "Febos", "Febos", "dbo.02-Febos srl$"
                res1 = collegaTabellaLince("d:\env01\company\febos\datilince\datilincefebos\banca_dati.xlsx", "datiLince", "A:M")
            ElseIf Me.SelectedCompany = 2 Then 'FebosTest
                collegaTabelle "FebosTestNew", "FebosTestNew", "dbo.02-Febos srl$"
                res1 = collegaTabellaLince("d:\env01\company\febos\datilince\datilincefebos\banca_dati.xlsx", "datiLince", "A:M")
            ElseIf Me.SelectedCompany = 3 Then 'Bridge
                collegaTabelle "Bridge", "Bridge", "dbo.Bridge srl$"
                res1 = collegaTabellaLince("d:\env01\company\febos\datilince\datilincebridge\banca_dati.xlsx", "datiLince", "A:M")
            ElseIf Me.SelectedCompany = 4 Then 'BridgeTest
                collegaTabelle "BridgeTest", "BridgeTestNew", "dbo.Bridge srl$"
                res1 = collegaTabellaLince("d:\env01\company\febos\datilince\datilincebridge\banca_dati.xlsx", "datiLince", "A:M")
            ElseIf Me.SelectedCompany = 5 Then 'NewEra
                collegaTabelle "NewEra", "FEBOS_10", "FEBOS S_r_l_$"
                ' TBD. Attenzione verificare che collegamento azienda usare
                ' commentato 11/01/23 non novrebbe più servire da tempo
                res1 = collegaTabellaLince("d:\env01\company\febos\datilince\datilincefebos\banca_dati.xlsx", "datiLince", "A:M")
            ElseIf Me.SelectedCompany = 6 Then 'NewEra
                collegaTabelle "NewEraTest", "FEBOS_TEST", "FEBOS S_r_l_$"
                ' TBD. Attenzione verificare che collegamento azienda usare
                ' commentato 11/01/23 non novrebbe più servire da tempo
                res1 = collegaTabellaLince("d:\env01\company\febos\datilince\datilincefebos\banca_dati.xlsx", "datiLince", "A:M")
            End If
        
        End If
    Else
        MsgBox "Privilegio non sufficiente"
    End If

End Sub

GO

-- Form_Principale:512-528
/* Private Sub TastoAmazon_Click */
Private Sub TastoAmazon_Click()
    DoCmd.Hourglass True
    If IsNull(Me.FiltroODVEAN) Or Me.FiltroODVEAN = "" Then
        MsgBox "Inserire filtro Ordine di Vendita"
        DoCmd.Hourglass False
        Exit Sub
  
    End If
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-DatiAmazon-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "AmazonEstrazione", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:530-535
/* Private Sub TastoAnalisiBudget_Click */
Private Sub TastoAnalisiBudget_Click()
    MsgBox "Funzionalità disabilitata; chiedere all'amministratore del sistema"
    Exit Sub
        
    DoCmd.OpenQuery "def01-Budget", acViewPivotChart, acReadOnly
End Sub

GO

-- Form_Principale:537-561
/* Private Sub TastoAnalisiDDTSpedizioniWarehouse_Click */
Private Sub TastoAnalisiDDTSpedizioniWarehouse_Click()
    
    DoCmd.Hourglass True
    
    ' estrazione tabella
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-AnalisiDDTESpedizioniWarehouse_Detail-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "WMS_AnalisiStatusDDT_Detail", exportFileName, True
    
    exportFileName = nomeAzienda & "-AnalisiDDTESpedizioniWarehouse-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "WMS_AnalisiStatusDDT", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata. Due file. Riepilogo e Dettaglio"

  

    ' EstrazioneStatisticheGenericaPerStagione "VendutoCompratoProiezione", "VendutoCompratoProiezione", "where"
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:563-570
/* Private Sub TastoAnalisiFatturato_Click */
Private Sub TastoAnalisiFatturato_Click()
    If DataIniziale.Value = "" Or IsNull(DataIniziale) = True Or DataFinale.Value = "" Or IsNull(DataFinale) = True Then
        MsgBox "Inserire periodo"
        Exit Sub
    End If
    DoCmd.OpenReport "fab01-FatturatoESconti-step02", acViewPreview, , "[Document Date]>=" & "#" & restituisciDataComeStringa(DataIniziale) & "# and " & "[Document Date]<=" & "#" & restituisciDataComeStringa(DataFinale) & "#"
    
End Sub

GO

-- Form_Principale:572-579
/* Private Sub TastoAnalisiNoteDiCredito_Click */
Private Sub TastoAnalisiNoteDiCredito_Click()
    If DataIniziale.Value = "" Or IsNull(DataIniziale) = True Or DataFinale.Value = "" Or IsNull(DataFinale) = True Then
        MsgBox "Inserire periodo"
        Exit Sub
    End If
    DoCmd.OpenReport "fab02-NoteCreditoESconti-step02", acViewPreview, , "[Document Date]>=" & "#" & restituisciDataComeStringa(DataIniziale) & "# and " & "[Document Date]<=" & "#" & restituisciDataComeStringa(DataFinale) & "#"

End Sub

GO

-- Form_Principale:581-584
/* Private Sub TastoAnalisiNoteDiCreditoEResi_Click */
Private Sub TastoAnalisiNoteDiCreditoEResi_Click()
    MsgBox "L'analisi include le sole note di credito con tipo ArticoloModello o Assortimento"
    DoCmd.OpenQuery "def01-ANALISINOTEDICREDITO-PIVOT", acViewPivotChart, acReadOnly
End Sub

GO

-- Form_Principale:586-651
/* Private Sub TastoAnalisiPortafoglioEPrenotazioni_Click */
Private Sub TastoAnalisiPortafoglioEPrenotazioni_Click()
    Dim RES As Integer
    RES = MsgBox("Eseguire un utente per volta. Non filtrabile per marchio, solo per stagione proseguire?", vbYesNo)
    If RES <> 6 Then Exit Sub
    ' PASSAGGIO INTERMENDIO CHE PREVEDE LA SCRITTURA IN TABELLA DEL CALCOLO TOTALE COPERTO
    
    ' verifica che almeno una stagione e una sia selezionata
    If Me.FiltroStagioneMultiSelezione.ItemsSelected.count <> 1 Then
        MsgBox "Selezionare una stagione"
        Exit Sub
    End If
    Dim FiltroStagione As String
    Dim TempStagioneNomeFile As String
    Dim oItem As Variant
    

    FiltroStagione = ""
    If Me!FiltroStagioneMultiSelezione.ItemsSelected.count <> 0 Then
        For Each oItem In Me.FiltroStagioneMultiSelezione.ItemsSelected
            FiltroStagione = Me!FiltroStagioneMultiSelezione.ItemData(oItem)
            TempStagioneNomeFile = TempStagioneNomeFile & Me!FiltroStagioneMultiSelezione.ItemData(oItem)
        Next oItem
    End If
    
    Me.FiltroStagionePrenotazioni = FiltroStagione
    DoCmd.Hourglass True
    
    ' cancellazione del contemuto della tabella
    CurrentDb.Execute "delete from [VenditeEPrenotazioni-CalcoloTotaleCoperto_TABELLA]"
    Dim qdf As QueryDef
    Set qdf = CurrentDb.QueryDefs("VenditeEPrenotazioni-CalcoloTotaleCoperto_query scrittura")
    qdf.Parameters("[forms]![principale]![filtrostagionePrenotazioni]") = FiltroStagione
    
    'RIABILITARE QUI
    qdf.Execute
    'MsgBox "calcolo preventivo fatto"
    
    ' creazione di una query temporanea che a partire da venditeeprenotazioni aggiunga sempre il filtro stagione obbligatorio
    Dim qdfTemp As QueryDef
    Dim qdfTempName As String
    qdfTempName = Now
    Set qdfTemp = CurrentDb.CreateQueryDef(qdfTempName)
    qdfTemp.SQL = CurrentDb.QueryDefs("VenditeEPrenotazioni").SQL
    
    ' non dovrebbe servire
    ' qdfTemp.Parameters("filtrostagione") = FiltroStagione
    ''rimozione ";"
    'qdfTemp.SQL = Left$(qdfTemp.SQL, InStr(qdfTemp.SQL, ";") - 1)
    ''aggiunta filtro stagione e marchio (where o having)
    'qdfTemp.SQL = qdfTemp.SQL & " where [Season code]='" & FiltroStagione & "'"
    
    
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-" & "AnalisiVenditeEPrenotazioni" & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00") & "-(" & TempStagioneNomeFile & ")"
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, qdfTemp.Name, exportFileName, True
    
    CurrentDb.QueryDefs.Delete qdfTemp.Name
            
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"
    

End Sub

GO

-- Form_Principale:653-668
/* Private Sub TastoAnalisiPosizionamento_Click */
Private Sub TastoAnalisiPosizionamento_Click()
    If Me.FiltroMarchio = "" Or IsNull(Me.FiltroMarchio) = True Or Me.FiltroStagione = "" Or IsNull(Me.FiltroStagione) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-DatiPosizionementoETaglie-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "AnalisiPosizionamento", exportFileName, True

    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:670-690
/* Private Sub TastoAnalisiSpedizioniWarehouse_Click */
Private Sub TastoAnalisiSpedizioniWarehouse_Click()
    
    DoCmd.Hourglass True
    
    ' estrazione tabella
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-AnalisiSpedizioniWarehouse-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "WMS_WarehouseShipment", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

  

    ' EstrazioneStatisticheGenericaPerStagione "VendutoCompratoProiezione", "VendutoCompratoProiezione", "where"
    DoCmd.Hourglass False


End Sub

GO

-- Form_Principale:693-701
/* Private Sub TastoAnalisiUsciteDDT_Click */
Private Sub TastoAnalisiUsciteDDT_Click()
    
    DoCmd.Hourglass True
    EstrazioneStatisticheGenericaPerStagione "AnalisiUsciteDDT", "AnalisiUsciteDDT", "where"
    DoCmd.Hourglass False
    
        

End Sub

GO

-- Form_Principale:703-708
/* Private Sub TastoAnalisiVenduto_Click */
Private Sub TastoAnalisiVenduto_Click()
    MsgBox "Funzionalità disabilitata; chiedere all'amministratore del sistema"
    Exit Sub
    
    DoCmd.OpenQuery "def01-ANALISIVENDUTO-PIVOT", acViewPivotChart, acReadOnly
End Sub

GO

-- Form_Principale:710-719
/* Private Sub TastoAnalisiVendutoComprato_Click */
Private Sub TastoAnalisiVendutoComprato_Click()
    MsgBox "Funzionalità disabilitata; chiedere all'amministratore del sistema"
    Exit Sub
    
    If IsNull(Forms!principale!FattoreCorrettivo) = True Then
        MsgBox ("Selezionare un fattore correttivo")
        Exit Sub
    End If
    DoCmd.OpenQuery "def01-ANALISIVENDUTOCOMPRATO-PIVOT-MOREDATA", acViewPivotChart, acReadOnly
End Sub

GO

-- Form_Principale:721-725
/* Private Sub TastoAndamentoConsegneAcquisti_Click */
Private Sub TastoAndamentoConsegneAcquisti_Click()
    ' per accelerare le prestazioni si richiede cmq il filtro per singola stagione direttamente nelle query di base
    EstrazioneStatisticheGenericaPerStagione "AnalisiDateConsegna", "AnalisiConsegneAcquistiItem", "where"
        
End Sub

GO

-- Form_Principale:727-731
/* Private Sub TastoAndamentoConsegneVendite_Click */
Private Sub TastoAndamentoConsegneVendite_Click()
    ' per accelerare le prestazioni si richiede cmq il filtro per singola stagione direttamente nelle query di base
    EstrazioneStatisticheGenericaPerStagione "AnalisiDateConsegnaVendite", "AnalisiConsegneVendite", "where"

End Sub

GO

-- Form_Principale:733-775
/* Private Sub TastoAndamentoInventario_Click */
Private Sub TastoAndamentoInventario_Click()
    If livelloUtente >= 1 Then
        If DataIniziale.Value = "" Or IsNull(DataIniziale) = True Or DataFinale.Value = "" Or IsNull(DataFinale) = True Then
            MsgBox "Inserire periodo"
        Exit Sub
      End If
        
        Dim RES As Integer
        RES = MsgBox("Attenzione deve essere eseguita da un utente per volta. Procedere?", vbYesNo)
        If RES <> 6 Then Exit Sub

        DoCmd.Hourglass True
        ' fase 1 cancellazione tabella
        CurrentDb.Execute "Delete from inventarioAndamento"
        ' fase 2 costruzione andamento in tabella
        Dim qdf As QueryDef
        Set qdf = CurrentDb.QueryDefs("InventarioAllaData-PerGiacenzaGiornaliera")
        
        Dim dataIn As Date
        Dim dataFin As Date
        dataIn = Me.DataIniziale
        dataFin = Me.DataFinale
        Dim dataCurr As Date
        dataCurr = dataIn
        While dataCurr <= dataFin
            qdf.Parameters("Inventory_Date") = dataCurr
            qdf.Execute
            dataCurr = dataCurr + 1
        Wend
        ' fase 3 esportazione
        Dim exportFileName As String
        exportFileName = nomeAzienda & "-AndamentoInventario-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "inventarioAndamento", exportFileName, True
        DoCmd.Hourglass False
        MsgBox "Estrazione Completata"
    
    Else
        MsgBox "Privilegio non sufficiente"
    End If

End Sub

GO

-- Form_Principale:777-789
/* Private Sub TastoAndamentoVendite_Click */
Private Sub TastoAndamentoVendite_Click()
    If Me.FiltroMarchio = "" Or IsNull(Me.FiltroMarchio) = True Or Me.FiltroStagione = "" Or IsNull(Me.FiltroStagione) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    DoCmd.Hourglass True
    DoCmd.OpenReport "AndamentoVendite", acViewPreview, , "[Trademark Code]='" & Me.FiltroMarchio & "'  and " & "[Season Code]='" & Me.FiltroStagione & "'"
    DoCmd.Hourglass False
    
    'Dim qdfTmp As QueryDef
    'Set qdfTmp = CurrentDb.QueryDefs()
    'qdfTmp.Parameters("parametromarchio") = DataEvoluzioneTmp
End Sub

GO

-- Form_Principale:791-800
/* Private Sub TastoAnnullamentiPerAgente_Click */
Private Sub TastoAnnullamentiPerAgente_Click()
    If Me.FiltroAgente = "" Or IsNull(Me.FiltroAgente) = True Or Me.FiltroMarchio = "" Or IsNull(Me.FiltroMarchio) = True Or Me.FiltroStagione = "" Or IsNull(Me.FiltroStagione) = True Then
        MsgBox "Inserire marchio, stagione e agente"
        Exit Sub
    End If
    DoCmd.Hourglass True
    DoCmd.OpenReport "AnnullamentiAgenteCliente", acViewPreview, , "[Marchio]='" & Me.FiltroMarchio & "'  and " & "[Stagione]='" & Me.FiltroStagione & "' " & " and [CodiceAgente]='" & Me.FiltroAgente & "'"
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:802-816
/* Private Sub TastoAnomalieAvanzamento_Click */
Private Sub TastoAnomalieAvanzamento_Click()
    If Me.CreditoFiltroStagione2 = "" Or IsNull(Me.CreditoFiltroStagione2) = True Then
        MsgBox "Inserire la stagione da analizzare"
        Exit Sub
    End If
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-DatiAnomalieOrdini_Avanzamento-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "AnalisiCredito-RicercaAnomalie_Sommario", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:818-821
/* Private Sub TastoApriRisultati_Click */
Private Sub TastoApriRisultati_Click()
    DoCmd.OpenQuery "IncrocioNew"

End Sub

GO

-- Form_Principale:823-842
/* Private Sub TastoBilancioPerSorgente_Click */
Private Sub TastoBilancioPerSorgente_Click()
    If livelloUtente >= 1 Then
        If DataIniziale.Value = "" Or IsNull(DataIniziale) = True Or DataFinale.Value = "" Or IsNull(DataFinale) = True Then
            MsgBox "Inserire periodo"
            Exit Sub
        End If
        DoCmd.Hourglass True
        Dim exportFileName As String
        exportFileName = nomeAzienda & "-BilancioPerSorgente" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "BilancioPerSorgente", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

    Else
        MsgBox "Privilegio non sufficiente"
    End If

End Sub

GO

-- Form_Principale:844-847
/* Private Sub TastoBoxBarcodePallet_Click */
Private Sub TastoBoxBarcodePallet_Click()
    DoCmd.OpenQuery "BoxBarcodePallet", acViewNormal, acReadOnly

End Sub

GO

-- Form_Principale:849-851
/* Private Sub TastoCambiaPassword_Click */
Private Sub TastoCambiaPassword_Click()
    DoCmd.OpenForm "CambiaPassword"
End Sub

GO

-- Form_Principale:853-866
/* Private Sub TastoCCBancariERiba_Click */
Private Sub TastoCCBancariERiba_Click()
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-CCBancari E Riba-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ControlloCCBancariRiba", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:868-950
/* Private Sub TastoCheckFattureEletttonicheAttive_Click */
Private Sub TastoCheckFattureEletttonicheAttive_Click()
    Dim Percorso As String

    Dim fSuccess As Boolean
    Dim oDoc As MSXML2.DOMDocument60
    Dim objErr As MSXML2.IXMLDOMParseError
    Dim xmlTransmission As Object 'MSXML2.IXMLDOMNode
    
    Set oDoc = New MSXML2.DOMDocument60
    
    oDoc.validateOnParse = False

    Dim V(10000) As String
    Dim i As Integer
    Dim x As Integer
    
    Percorso = "\\Norman\fe\PROD\FEBOS\FEATTIVA\Documenti_Temp\"
    
    'Add the files to the array.
    Dim strTemp As String
    strTemp = Dir(Percorso & "\*.*")
    i = 1
    Do While strTemp <> vbNullString
        'Debug.Print strTemp
        V(i) = strTemp
        i = i + 1
        strTemp = Dir
    Loop
    
    Dim RES As Integer
    RES = MsgBox("Attenzione attività da eseguire una persona per volta. Proseguire", vbYesNo)
    If RES <> 6 Then Exit Sub
    DoCmd.Hourglass True
    CurrentDb.Execute "Delete from FattureElettronicheAttive"
    Dim rst As DAO.Recordset
    
    Set rst = CurrentDb.OpenRecordset("FattureElettronicheAttive")
    For x = 1 To i - 1 'for each file found, by the count (or index)
        rst.AddNew
        fSuccess = oDoc.Load(Percorso & V(x))
        If fSuccess = False Then
            Debug.Print V(x) & ":     --->" & Percorso & V(x)
            Debug.Print ("loading error")
            rst!nomefile = V(x)
            rst!risultato = "ERRORE"
        Else
            rst!nomefile = V(x)
            rst!risultato = "OK"
        
        End If
        rst.Update
        
        ' pezzo non usato navigazione
        'Dim XDoc As Object, root As Object
     
        'Set XDoc = CreateObject("MSXML2.DOMDocument")
        'XDoc.async = False: XDoc.validateOnParse = False
        'XDoc.Load (Percorso & V(x))
        'Set root = XDoc.documentElement
    
        'For Each xmlTransmission In oDoc.childNodes 'xmlNodes
        '    Debug.Print "NODE"
            '...do a bunch of stuff...
        'Next xmlTransmission
        
        ' pezzo non usato per fare validazione
        'Set objErr = oDoc.validate
        'If objErr.errorCode = 0 Then
        '    Debug.Print "No errors found"
        'Else
        '    Debug.Print "Error parser: " & objErr.errorCode & "; " & objErr.reason
        'End If
    Next
    rst.Close
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-ControlloFattureElettronicheAttive-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "FattureElettronicheAttive", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "XML con errori controllo ed completata"
    
End Sub

GO

-- Form_Principale:952-968
/* Private Sub TastoCheckProvincie_Click */
Private Sub TastoCheckProvincie_Click()
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-ListaClientiProvincieFatturazioneElettronica-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ListaClientiProvinciePerFatturazioneElettronica", exportFileName, True
    
    exportFileName = nomeAzienda & "-ListaOrdiniEResiProvincieFatturazioneElettronica-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ListaClientiShipToOrdiniProvinciePerFatturazioneElettronica", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:970-989
/* Private Sub TastoCheckStatusIndicom_Click */
Private Sub TastoCheckStatusIndicom_Click()
    If DataFinale.Value = "" Or IsNull(DataFinale) = True Or DataIniziale.Value = "" Or IsNull(DataIniziale) = True Then
            MsgBox "Inserire data iniziale e finale"
            Exit Sub
    End If
    
    MsgBox "Attenzione nella cartella X:\checkFattureEmesse deve essere presente il file 'Fatture emesse.xls' in formato excel 97-2003"
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-CheckStatusIndicom-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "FattureRegistrateENDC-PerFatturazioneElettronica", exportFileName, True
    
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:991-1005
/* Private Sub TastoCheckStatusSDIFattureElettronichePassive_Click */
Private Sub TastoCheckStatusSDIFattureElettronichePassive_Click()
    
    MsgBox "Attenzione nella cartella X:\checkAgenziaEntrateFatturazioneElettronica deve essere presente il file 'AGE.xls' in formato excel 97-2003"
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-Verifica_AGE_NAV-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "VerificaAGE_NAV", exportFileName, True
    
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"
End Sub

GO

-- Form_Principale:1007-1025
/* Private Sub TastoCheckStatusSDILog_Click */
Private Sub TastoCheckStatusSDILog_Click()
    If DataFinale.Value = "" Or IsNull(DataFinale) = True Or DataIniziale.Value = "" Or IsNull(DataIniziale) = True Then
            MsgBox "Inserire data iniziale e finale"
            Exit Sub
    End If
    
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-CheckStatusSDILog-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "FattureRegistrateENDC-PerFatturazioneElettronica-ControlloSDILog", exportFileName, True
    
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:1027-1034
/* Private Sub TastoClientiConVenduto_Click */
Private Sub TastoClientiConVenduto_Click()
    MsgBox "Funzionalità disabilitata; chiedere all'amministratore del sistema"
    Exit Sub
    
    
    DoCmd.OpenQuery "ClientiConVenduto", acViewNormal, acReadOnly

End Sub

GO

-- Form_Principale:1036-1043
/* Private Sub TastoClientiConVendutoCalcoloEsposizione_Click */
Private Sub TastoClientiConVendutoCalcoloEsposizione_Click()
    MsgBox "Funzionalità disabilitata; chiedere all'amministratore del sistema"
    Exit Sub
    
    
    DoCmd.OpenQuery "ClientiConVendutoCalcoloEsposizione", acViewNormal, acReadOnly

End Sub

GO

-- Form_Principale:1045-1054
/* Private Sub TastoCoinBolla_Click */
Private Sub TastoCoinBolla_Click()
    If IsNull(Me.FiltroDDTDaTrasferimento) Or Me.FiltroDDTDaTrasferimento = "" Then
        MsgBox "Inserire filtro DDT da trasferimento"
        Exit Sub
    End If
    DoCmd.Hourglass True
        
    DoCmd.OpenQuery "EstraiDatiCoinBolla", acViewNormal, acReadOnly
    DoCmd.Hourglass False
End Sub

GO

-- Form_Principale:1056-1177
/* Private Sub TastoCollegaEcontrolla_Click */
Private Sub TastoCollegaEcontrolla_Click()
    DoCmd.Hourglass True

    ' cancellare link corrente sheet1
    ' NOME A CASO QUI
    Dim L As Long
    Randomize
    L = Int((1000000 * Rnd) + 1)
    
    'DoCmd.DeleteObject acTable, "TESTBLAC"
    ' inserire il numero di delivery
    'DoCmd.TransferSpreadsheet acLink, acSpreadsheetTypeExcel9, "Sap", ".\" & Me.FileExcel, True, "Sheet2"
    'On Error Resume Next
    Dim tableName As String, qLettureName As String, qControlloLettureName As String, qGroupedName As String, qPreCheckName As String, qFinalName As String, qMistakeName As String, tLettureName As String
    tableName = "BLACLetture" & Format$(L, "00000000")
    tLettureName = "BLACLettureCartoni" & Format$(L, "00000000")
    qLettureName = "BLACQDF" & Format$(L, "00000000")
    qControlloLettureName = "BLACQDFCL" & Format$(L, "00000000")
    qGroupedName = "BLACGR" & Format$(L, "00000000")
    qPreCheckName = "BLACPC" & Format$(L, "00000000")
    qFinalName = "BLACFN" & Format$(L, "00000000")
    qMistakeName = "BLACMSTK" & Format$(L, "00000000")
    
    ' collega excel letture
    DoCmd.TransferSpreadsheet acLink, acSpreadsheetTypeExcel9, tableName, Me.percorsoSalvataggioLetture & CasellaFileControllo.Value, 0
    ' MsgBox "FileLettureCollegato" & Me.FileExcel & " è stato collegata"
    'DoCmd.OpenTable tableName, acViewNormal, acReadOnly
    
    
    Dim qdfLetture As QueryDef, qdfControlloLetture As QueryDef, qdfGrouped As QueryDef, qdfPreCheck As QueryDef, qdfFinal As QueryDef, qdfMistake As QueryDef
    
    ' letture sistemate
    Set qdfLetture = CurrentDb.CreateQueryDef(qLettureName, "SELECT f2 AS CARTONE, IIf(Len([F1])=13,Format$([F1],'0000000000000'),Format$([F1],'000000000000')) AS EANCODELETTORETXT FROM " & tableName)
    
    ' crea una tabella volatile dove accanto alle letture crea il codice del cartone (che è messo solo nel primo "record")
    DoCmd.CopyObject , tLettureName, acTable, "LettureTemplate"
    Dim rst_in As DAO.Recordset, rst_out As DAO.Recordset
    Dim cartoneNr As String
    Set rst_in = CurrentDb.OpenRecordset(qdfLetture.Name)
    Set rst_out = CurrentDb.OpenRecordset(tLettureName)
    If rst_in.RecordCount > 0 Then
        rst_in.MoveFirst
        cartoneNr = rst_in!CARTONE
        While rst_in.EOF = False
            rst_out.AddNew
            rst_out!eancodelettore = rst_in!EANCODELETTORETXT
            If rst_in!CARTONE <> "" And rst_in!CARTONE <> cartoneNr Then cartoneNr = rst_in!CARTONE
            rst_out!CARTONE = cartoneNr
            rst_in.MoveNext
            rst_out.Update
            Wend
    End If
    
    rst_in.Close
    rst_out.Close
    
    Dim STR As String
    
    STR = "SELECT " & qLettureName & ".EANCODELETTORETXT, Item.No_, Item.[MODEL ITEM NO_], Item.[VARIABLE CODE 01] AS COLOR, Item.[VARIABLE CODE 02] AS [SIZE], Sum(1) AS QTY_LETTURE FROM " & qLettureName & " LEFT JOIN (EANCodes_CleanDoubled_PerBLAC LEFT JOIN Item ON EANCodes_CleanDoubled_PerBLAC.[Item No_] = Item.No_) ON " & qLettureName & ".EANCODELETTORETXT = EANCodes_CleanDoubled_PerBLAC.[Cross-Reference No_] GROUP BY " & qLettureName & ".EANCODELETTORETXT, Item.No_, Item.[MODEL ITEM NO_], Item.[VARIABLE CODE 01], Item.[VARIABLE CODE 02];"
    Set qdfControlloLetture = CurrentDb.CreateQueryDef(qControlloLettureName, STR)
    
    STR = "SELECT [Document No_] AS RIGA, [Cross-Reference No_] AS EANCode, [MODEL ITEM NO_], COLOR_spd, SIZE_spd, QTY_bolla, 0 AS qty_letture FROM ControlliBLAC_SPD union all SELECT 'LETTURE' AS RIGA, EANCODELETTORETXT,[MODEL ITEM NO_],COLOR,SIZE,0,QTY_LETTURE FROM " & qControlloLettureName
    Set qdfGrouped = CurrentDb.CreateQueryDef(qGroupedName, STR)
    
    STR = "SELECT EANCode, [MODEL ITEM NO_], COLOR_spd, SIZE_spd, Sum(QTY_bolla) AS QTY_bolla_, Sum(qty_letture) AS qty_letture_ FROM " & qGroupedName & " GROUP BY EANCode, [MODEL ITEM NO_], COLOR_spd, SIZE_spd;"
    Set qdfPreCheck = CurrentDb.CreateQueryDef(qPreCheckName, STR)
    
    STR = "SELECT EANCode, [MODEL ITEM NO_], COLOR_spd, SIZE_spd, QTY_bolla_, qty_letture_, IIf([qty_bolla_]<>[qty_letture_],'N') AS Test FROM " & qPreCheckName
    Set qdfFinal = CurrentDb.CreateQueryDef(qFinalName, STR)
    
    
    'DoCmd.OpenQuery qdfFinal.Name, acViewNormal, acReadOnly
    
    Dim exportFileName As String
    exportFileName = nomeAzienda & "ControllaLettureSPD-" & SubstSlashDash(Me.FiltroSpdControlliLettureBLAC) & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, qdfFinal.Name, exportFileName, True
    
    
    'STR = "SELECT EANCode, [MODEL ITEM NO_], COLOR_spd, SIZE_spd, CARTONE, Sum(qty_letture_) AS QTY FROM " & qdfFinal.Name & " INNER JOIN " & qdfLetture.Name & " ON EANCode = EANCODELETTORETXT WHERE (((Test)='N')) GROUP BY EANCode, [MODEL ITEM NO_], COLOR_spd, SIZE_spd, CARTONE"
    STR = "SELECT " & qdfFinal.Name & ".*, CARTONE FROM " & tLettureName & " INNER JOIN " & qdfFinal.Name & " ON " & tLettureName & ".EANCODELETTORE = " & qdfFinal.Name & ".EANCode"
    Set qdfMistake = CurrentDb.CreateQueryDef(qMistakeName, STR)
    
    ' determina se è il caso di esportare anche il dettaglio colli degli articoli con problemi nel caso ci siano problemi ed avvisa l'utente
    
    Dim rst As DAO.Recordset, MISTAKE As Boolean
    MISTAKE = False
    
    qdfMistake.Parameters("[forms]![principale]![FiltroSpdControlliLettureBLAC]") = Me.FiltroSpdControlliLettureBLAC
    qdfMistake.Parameters("[forms]![principale]![FiltroStagioneControlliLettureBLAC]") = Me.FiltroStagioneControlliLettureBLAC
    Set rst = qdfMistake.OpenRecordset()
    If rst.RecordCount > 0 Then
        MISTAKE = False
        While rst.EOF = False
            If rst!test = "N" Then MISTAKE = True
            rst.MoveNext
        Wend
    End If
    
    If MISTAKE = False Then
        DoCmd.Hourglass False
        MsgBox "Estrazione Completata"
    Else
        exportFileName = nomeAzienda & "ControllaLettureSPD-" & SubstSlashDash(Me.FiltroSpdControlliLettureBLAC) & "_ERRORI-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, qdfMistake.Name, exportFileName, True
        DoCmd.Hourglass False
        MsgBox "Estrazione Completata CON ERRORI"
    End If
    rst.Close
    
    DoCmd.DeleteObject acTable, tableName
    DoCmd.DeleteObject acQuery, qdfLetture.Name
    DoCmd.DeleteObject acTable, tLettureName
    DoCmd.DeleteObject acQuery, qdfControlloLetture.Name
    DoCmd.DeleteObject acQuery, qdfGrouped.Name
    DoCmd.DeleteObject acQuery, qdfPreCheck.Name
    DoCmd.DeleteObject acQuery, qdfFinal.Name
    DoCmd.DeleteObject acQuery, qdfMistake.Name

End Sub

GO

-- Form_Principale:1179-1305
/* Private Sub TastoCollegaEcontrollaResi_Click */
Private Sub TastoCollegaEcontrollaResi_Click()
    DoCmd.Hourglass True

    ' cancellare link corrente sheet1
    ' NOME A CASO QUI
    Dim L As Long
    Randomize
    L = Int((1000000 * Rnd) + 1)
    
    'DoCmd.DeleteObject acTable, "TESTBLAC"
    ' inserire il numero di delivery
    'DoCmd.TransferSpreadsheet acLink, acSpreadsheetTypeExcel9, "Sap", ".\" & Me.FileExcel, True, "Sheet2"
    'On Error Resume Next
    Dim tableName As String, qLettureName As String, qControlloLettureName As String, qGroupedName As String, qPreCheckName As String, qFinalName As String, qMistakeName As String, tLettureName As String
    tableName = "ResiLetture" & Format$(L, "00000000")
    tLettureName = "ResiLettureCartoni" & Format$(L, "00000000")
    qLettureName = "ResiQDF" & Format$(L, "00000000")
    qControlloLettureName = "ResiQDFCL" & Format$(L, "00000000")
    qGroupedName = "ResiCGR" & Format$(L, "00000000")
    qPreCheckName = "ResiPC" & Format$(L, "00000000")
    qFinalName = "ResiFN" & Format$(L, "00000000")
    qMistakeName = "ResiSTK" & Format$(L, "00000000")
    
    ' collega excel letture
    DoCmd.TransferSpreadsheet acLink, acSpreadsheetTypeExcel9, tableName, Me.percorsoSalvataggioLettureResi & CasellaFileControlloResi.Value, 0
    ' MsgBox "FileLettureCollegato" & Me.FileExcel & " è stato collegata"
    'DoCmd.OpenTable tableName, acViewNormal, acReadOnly
    
    
    Dim qdfLetture As QueryDef, qdfControlloLetture As QueryDef, qdfGrouped As QueryDef, qdfPreCheck As QueryDef, qdfFinal As QueryDef, qdfMistake As QueryDef
    
    ' letture sistemate
    Set qdfLetture = CurrentDb.CreateQueryDef(qLettureName, "SELECT f2 AS CARTONE, IIf(Len([F1])=13,Format$([F1],'0000000000000'),Format$([F1],'000000000000')) AS EANCODELETTORETXT FROM " & tableName)
    
    ' crea una tabella volatile dove accanto alle letture crea il codice del cartone (che è messo solo nel primo "record")
    DoCmd.CopyObject , tLettureName, acTable, "LettureTemplate"
    Dim rst_in As DAO.Recordset, rst_out As DAO.Recordset
    Dim cartoneNr As String
    Set rst_in = CurrentDb.OpenRecordset(qdfLetture.Name)
    Set rst_out = CurrentDb.OpenRecordset(tLettureName)
    If rst_in.RecordCount > 0 Then
        rst_in.MoveFirst
        cartoneNr = rst_in!CARTONE
        While rst_in.EOF = False
            rst_out.AddNew
            rst_out!eancodelettore = rst_in!EANCODELETTORETXT
            If rst_in!CARTONE <> "" And rst_in!CARTONE <> cartoneNr Then cartoneNr = rst_in!CARTONE
            rst_out!CARTONE = cartoneNr
            rst_in.MoveNext
            rst_out.Update
            Wend
    End If
    
    rst_in.Close
    rst_out.Close
    
    Dim STR As String
    
    ' old senza description 2
    ' STR = "SELECT " & qLettureName & ".EANCODELETTORETXT, Item.No_, Item.[MODEL ITEM NO_], Item.[VARIABLE CODE 01] AS COLOR, Item.[VARIABLE CODE 02] AS [SIZE], Sum(1) AS QTY_LETTURE, CARTONE FROM " & qLettureName & " ____________________LEFT JOIN (EANCodes_CleanDoubled_PerResi LEFT JOIN Item ON EANCodes_CleanDoubled_PerResi.[Item No_] = Item.No_) ON " & qLettureName & ".EANCODELETTORETXT = EANCodes_CleanDoubled_PerResi.[Cross-Reference No_] GROUP BY " & qLettureName & ".EANCODELETTORETXT, Item.No_, Item.[MODEL ITEM NO_], Item.[VARIABLE CODE 01], Item.[VARIABLE CODE 02], CARTONE;"
    
    
    STR = "SELECT EANCODELETTORETXT, Item.No_, Item.[Trademark Code], Item.[Season Code], Item.[MODEL ITEM NO_], Item_1.[Description 2] AS Description2, Item.[VARIABLE CODE 01] AS COLOR, Item.[VARIABLE CODE 02] AS [SIZE], Sum(1) AS QTY_LETTURE, CARTONE FROM (" & qLettureName & " LEFT JOIN (EANCodes_CleanDoubled_PerResi LEFT JOIN Item ON EANCodes_CleanDoubled_PerResi.[Item No_] = Item.No_) ON " & qLettureName & ".EANCODELETTORETXT = EANCodes_CleanDoubled_PerResi.[Cross-Reference No_]) LEFT JOIN Item AS Item_1 ON Item.[Model Item No_] = Item_1.No_ GROUP BY EANCODELETTORETXT, Item.No_, item.[Trademark code], item.[Season Code], Item.[MODEL ITEM NO_], Item_1.[Description 2], Item.[VARIABLE CODE 01], Item.[VARIABLE CODE 02], CARTONE;"
    'STR = "SELECT EANCODELETTORETXT, Item.No_, Item.[MODEL ITEM NO_], Item_1.[Description 2] AS Description2, Item.[VARIABLE CODE 01] AS COLOR, Item.[VARIABLE CODE 02] AS [SIZE], Sum(1) AS QTY_LETTURE, CARTONE FROM (" & qLettureName & " LEFT JOIN (EANCodes_CleanDoubled_PerResi LEFT JOIN Item ON EANCodes_CleanDoubled_PerResi.[Item No_] = Item.No_) ON " & qLettureName & ".EANCODELETTORETXT = EANCodes_CleanDoubled_PerResi.[Cross-Reference No_]) LEFT JOIN Item AS Item_1 ON Item.[Model Item No_] = Item_1.No_ GROUP BY EANCODELETTORETXT, Item.No_, Item.[MODEL ITEM NO_], Item_1.[Description 2], Item.[VARIABLE CODE 01], Item.[VARIABLE CODE 02], CARTONE;"
    Set qdfControlloLetture = CurrentDb.CreateQueryDef(qControlloLettureName, STR)
    
    STR = "SELECT [Document No_] AS RIGA, [Cross-Reference No_] AS EANCode, [Trademark Code], [Season Code], [MODEL ITEM NO_], description2_odr, COLOR_ODR, SIZE_ODR, QTY_Resi, 0 AS qty_letture, '' AS CARTONE FROM ControlliResi_ODR union all SELECT 'LETTURE' AS RIGA, EANCODELETTORETXT, [TRADEMARK CODE], [SEASON CODE], [MODEL ITEM NO_], description2, COLOR,SIZE,0,QTY_LETTURE, CARTONE FROM " & qControlloLettureName
    'STR = "SELECT [Document No_] AS RIGA, [Cross-Reference No_] AS EANCode, [MODEL ITEM NO_], description2_odr, COLOR_ODR, SIZE_ODR, QTY_Resi, 0 AS qty_letture, '' AS CARTONE FROM ControlliResi_ODR union all SELECT 'LETTURE' AS RIGA, EANCODELETTORETXT,[MODEL ITEM NO_], description2, COLOR,SIZE,0,QTY_LETTURE, CARTONE FROM " & qControlloLettureName
    Set qdfGrouped = CurrentDb.CreateQueryDef(qGroupedName, STR)
    
    'STR = "SELECT EANCode, [MODEL ITEM NO_], COLOR_spd, SIZE_spd, Sum(QTY_resi) AS QTY_resi_, Sum(qty_letture) AS qty_letture_ FROM " & qGroupedName & " GROUP BY EANCode, [MODEL ITEM NO_], COLOR_ODR, SIZE_ODR;"
    'Set qdfPreCheck = CurrentDb.CreateQueryDef(qPreCheckName, STR)
    
    'STR = "SELECT EANCode, [MODEL ITEM NO_], COLOR_ODR, SIZE_ODR, QTY_bolla_, qty_letture_, IIf([qty_RESI_]<>[qty_letture_],'N') AS Test FROM " & qPreCheckName
    'Set qdfFinal = CurrentDb.CreateQueryDef(qFinalName, STR)
    
    
    
    
    Dim exportFileName As String
    exportFileName = nomeAzienda & "ControllaLettureResi-" & SubstSlashDash(Me.FiltroORDControlliLettureResi) & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, qdfGrouped.Name, exportFileName, True
    'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, qdfFinal.Name, exportFileName, True
    
    
    'STR = "SELECT " & qdfFinal.Name & ".*, CARTONE FROM " & tLettureName & " INNER JOIN " & qdfFinal.Name & " ON " & tLettureName & ".EANCODELETTORE = " & qdfFinal.Name & ".EANCode"
    'Set qdfMistake = CurrentDb.CreateQueryDef(qMistakeName, STR)
    
    ' determina se è il caso di esportare anche il dettaglio colli degli articoli con problemi nel caso ci siano problemi ed avvisa l'utente
    
    Dim rst As DAO.Recordset, MISTAKE As Boolean
    MISTAKE = False
    
    'qdfMistake.Parameters("[forms]![principale]![FiltroordControlliLettureresi]") = Me.FiltroORDControlliLettureResi
    'qdfMistake.Parameters("[forms]![principale]![FiltroStagioneControlliLettureresi]") = Me.FiltroStagioneControlliLettureResi
    'Set rst = qdfMistake.OpenRecordset()
    'If rst.RecordCount > 0 Then
    '    MISTAKE = False
    '    While rst.EOF = False
    '        If rst!test = "N" Then MISTAKE = True
    '        rst.MoveNext
    '    Wend
    'End If
    
    If MISTAKE = False Then
        DoCmd.Hourglass False
        MsgBox "Estrazione Completata"
    Else
        'exportFileName = nomeAzienda & "ControllaLettureSPD-" & SubstSlashDash(Me.FiltroSpdControlliLettureBLAC) & "_ERRORI-" & Format$(Year(Now), "00") & Format$(Month(Now), "00")
        'exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, qdfMistake.Name, exportFileName, True
        'DoCmd.Hourglass False
        MsgBox "Estrazione Completata CON ERRORI"
    End If
    'rst.Close
    
    DoCmd.DeleteObject acTable, tableName
    DoCmd.DeleteObject acQuery, qdfLetture.Name
    DoCmd.DeleteObject acTable, tLettureName
    DoCmd.DeleteObject acQuery, qdfControlloLetture.Name
    DoCmd.DeleteObject acQuery, qdfGrouped.Name
    'DoCmd.DeleteObject acQuery, qdfPreCheck.Name
    'DoCmd.DeleteObject acQuery, qdfFinal.Name
    'DoCmd.DeleteObject acQuery, qdfMistake.Name
End Sub

GO

-- Form_Principale:1307-1318
/* Private Sub tastoCollegaEDI_Click */
Private Sub tastoCollegaEDI_Click()
    ' cancellare link corrente sheet1
    On Error Resume Next
    DoCmd.DeleteObject acTable, "EDI"
    On Error GoTo 0
    ' inserire il numero di delivery
    DoCmd.TransferText acImportFixed, "EDI specifica di importazione", "EDI", EDICheckFolder & Me.FileEdi, False
    MsgBox "La delivery " & Me.FileEdi & " è stata collegata"
    'DoCmd.OpenTable "EDI", acViewNormal, acReadOnly
    DoCmd.OpenQuery "DeliveryCheck", acViewNormal, acReadOnly

End Sub

GO

-- Form_Principale:1320-1330
/* Private Sub TastoCollegaTxT_Click */
Private Sub TastoCollegaTxT_Click()
    ' cancellare link corrente sheet1
    On Error Resume Next
    DoCmd.DeleteObject acTable, "Navision"
    On Error GoTo 0
    ' inserire il numero di delivery
    DoCmd.TransferText acImportDelim, "TXT specifica di importazione", "Navision", SapDataCheckFolder & Me.FileNavision, False
    MsgBox "L'ordine Navision" & Me.FileNavision & " è stata collegato"
    DoCmd.OpenQuery "TotaliNavision", acViewNormal, acReadOnly

End Sub

GO

-- Form_Principale:1332-1343
/* Private Sub TastoCollegaXLS_Click */
Private Sub TastoCollegaXLS_Click()
    ' cancellare link corrente sheet1
    On Error Resume Next
    DoCmd.DeleteObject acTable, "SAP"
    On Error GoTo 0
    ' inserire il numero di delivery
    'DoCmd.TransferSpreadsheet acLink, acSpreadsheetTypeExcel9, "Sap", ".\" & Me.FileExcel, True, "Sheet2"
    DoCmd.TransferSpreadsheet acLink, acSpreadsheetTypeExcel9, "Sap", SapDataCheckFolder & Me.FileExcel, True
    MsgBox "L'ordine SAP" & Me.FileExcel & " è stato collegata"
    DoCmd.OpenQuery "TotaliSap", acViewNormal, acReadOnly

End Sub

GO

-- Form_Principale:1345-1363
/* Private Sub TastoColliGiacenza_Click */
Private Sub TastoColliGiacenza_Click()
    DoCmd.Hourglass True
    
    ' estrazione tabella
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-WMS_ColliGiacenti-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "WMS_ColliGiacenti", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

  

    ' EstrazioneStatisticheGenericaPerStagione "VendutoCompratoProiezione", "VendutoCompratoProiezione", "where"
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:1365-1376
/* Private Sub TastoCommentiOrdini_Click */
Private Sub TastoCommentiOrdini_Click()
    DoCmd.Hourglass True
    If IsNull(Me.FiltroStagioneEAN) Or Me.FiltroStagioneEAN = "" Then
        MsgBox "Inserire filtro stagione"
        DoCmd.Hourglass False
        Exit Sub
    End If

    DoCmd.OpenQuery "CommentiOrdiniDiVendita", acViewNormal, acReadOnly
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:1378-1386
/* Private Sub TastoConfrontoStagioniPerAgente_Click */
Private Sub TastoConfrontoStagioniPerAgente_Click()
    If Me.FiltroStagione1 = "" Or IsNull(Me.FiltroStagione1) = True Or Me.FiltroStagione2 = "" Or IsNull(Me.FiltroStagione2) = True Or Me.FiltroStagione3 = "" Or IsNull(Me.FiltroStagione3) = True Or Me.FiltroAgente = "" Or IsNull(Me.FiltroAgente) = True Then
        MsgBox "Inserire agente e stagioni da confrontare"
        Exit Sub
    End If
    DoCmd.Hourglass True
    DoCmd.OpenReport "ReportConfrontoStagioniAgente", acViewPreview, , "[SalespersonCode]='" & FiltroAgente & " '"
    DoCmd.Hourglass False
End Sub

GO

-- Form_Principale:1388-1401
/* Private Sub TastoConfrontoVendutoComprato_Click */
Private Sub TastoConfrontoVendutoComprato_Click()
    If Me.FiltroMarchio = "" Or IsNull(Me.FiltroMarchio) = True Or Me.FiltroStagione = "" Or IsNull(Me.FiltroStagione) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    Dim filterString As String
    filterString = "[Trademark Code]='" & Me.FiltroMarchio & "'  and " & "[Season Code]='" & Me.FiltroStagione & "'"
    If Me.FiltroCollezione <> "" Then
        filterString = filterString & " and [Collection Code]='" & Me.FiltroCollezione & "'"
    End If
    DoCmd.Hourglass True
    DoCmd.OpenReport "ReportConfrontoVendutoComprato", acViewPreview, , filterString
    DoCmd.Hourglass False
End Sub

GO

-- Form_Principale:1403-1421
/* Private Sub TastoConteggioImpostaBollo_Click */
Private Sub TastoConteggioImpostaBollo_Click()
    If DataFinale.Value = "" Or IsNull(DataFinale) = True Or DataIniziale.Value = "" Or IsNull(DataIniziale) = True Then
            MsgBox "Inserire data iniziale e finale"
            Exit Sub
    End If
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-ImpostaBolloFatturazioneElettronica-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "RicercaPerBolloFatturazioneElettronica", exportFileName, True
    
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"


End Sub

GO

-- Form_Principale:1423-1431
/* Private Sub TastoControllaCategoriePesi_Click */
Private Sub TastoControllaCategoriePesi_Click()
    If Me.FiltroStagionePesiDiDefault.Value = "" Or IsNull(Me.FiltroStagionePesiDiDefault) = True Or Me.FiltroMarchioPesiDiDefault.Value = "" Or IsNull(Me.FiltroMarchioPesiDiDefault) = True Then
        MsgBox "Inserire il filtro stagione e marchio"
        Exit Sub
    End If
    
    DoCmd.OpenQuery "AggiornamentoDatiPesi_Precheck", acViewNormal, acReadOnly

End Sub

GO

-- Form_Principale:1433-1450
/* Private Sub TastoControllaGiacenzeDaLetturePaiaLibere_Click */
Private Sub TastoControllaGiacenzeDaLetturePaiaLibere_Click()
    
    If Me.FiltroDataPerControlloGiacenze.Value = "" Or IsNull(FiltroDataPerControlloGiacenze) = True Then
            MsgBox "Inserire data per controllo giacenze"
            Exit Sub
    End If

    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-ControllaGiacenzaPaiaLibere-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ControlloGiacenzaPaiaLibere-final", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"


End Sub

GO

-- Form_Principale:1452-1463
/* Private Sub TastoControllaGiacenzeDaLetturePaiaLibereLogimodaAssortimenti_Click */
Private Sub TastoControllaGiacenzeDaLetturePaiaLibereLogimodaAssortimenti_Click()
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-ControllaGiacenzaPaiaSfuseLibereLogimoDaAssortimenti-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ControlloMagazzinoLogimodaEConta", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:1465-1476
/* Private Sub TastoControlloPDISbilanciate_Click */
Private Sub TastoControlloPDISbilanciate_Click()
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-ControlloSbilanciamentoPDI-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ControlloSbilanciamentoAssegni", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"


End Sub

GO

-- Form_Principale:1478-1491
/* Private Sub TastoControlloQuantitaPrelievoeSpedWarehouse_Click */
Private Sub TastoControlloQuantitaPrelievoeSpedWarehouse_Click()
    DoCmd.Hourglass True
    
    ' estrazione tabella
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-WMS_TestOUTPRE_Diverso_SpedWhse-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "WMS_TestOUTPRE_Diverso_SpedWhse", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:1493-1506
/* Private Sub TastoControlloQuantitaPrelievoeSpedWarehouseDettaglio_Click */
Private Sub TastoControlloQuantitaPrelievoeSpedWarehouseDettaglio_Click()
    DoCmd.Hourglass True
    
    ' estrazione tabella
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-WMS_TestOUTPRE_Diverso_SpedWhse-DETTAGLIO_" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "WMS_TestOUTPRE_Diverso_SpedWhse_DETTAGLIO", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:1508-1524
/* Private Sub TastoControlloRoyalties_Click */
Private Sub TastoControlloRoyalties_Click()
    ' test preventivi e messaggio di attenzione
    If Me.FiltroMarchioTempiPagamento = "" Or IsNull(Me.FiltroMarchioTempiPagamento) = True Or Me.FiltroStagioneAreaAmministrativa = "" Or IsNull(Me.FiltroStagioneAreaAmministrativa) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-ControlloSoggettiRoyalties-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ControlloSoggettiRoyalties", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

    
End Sub

GO

-- Form_Principale:1526-1536
/* Private Sub TastoControlloSalesHeaderEExtension_Click */
Private Sub TastoControlloSalesHeaderEExtension_Click()
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-SalesHeaderEExtension-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ControlloSalesHeaderEExtension", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:1538-1541
/* Private Sub TastoCreaRigheBudgetProiezioni_Click */
Private Sub TastoCreaRigheBudgetProiezioni_Click()
    CurrentDb.Execute ("VendutoCompratoProiezione_CreazioneRigheBudgetProiezione")
    MsgBox "Completato"
End Sub

GO

-- Form_Principale:1543-1607
/* Private Sub TastoCreaValA_Click */
Private Sub TastoCreaValA_Click()
    MsgBox "Attenzione funziona solo in presena di listino acquisto USD o Euro (vuoto)"
    Dim RES As Integer
    RES = MsgBox("Procedere con la creazione?", vbYesNo)
    If RES <> 6 Then Exit Sub
    
    If livelloUtente >= 2 Then
        If DataCreazioneValoriMagazzino.Value = "" Or IsNull(DataCreazioneValoriMagazzino) = True Or TassoDiCambioValutazioneMagazzino.Value = "" Or IsNull(TassoDiCambioValutazioneMagazzino) = True Or PercentualeSvalutazioneVALB = "" Or IsNull(PercentualeSvalutazioneVALB) = True Then
            MsgBox "Inserire data, percentuale svalutazione e tasso di cambio per valorizzazione"
            Exit Sub
        End If
        DoCmd.Hourglass True
        ' VISUALIZZAZIONE CASI ANOMALI
        ' TUTTI QUELLI CHE HANNO GIA' DIVERSI PREZZI DI ACQUISTO A PARITA' DI MODELITEM, E VARIABILI
        DoCmd.OpenQuery ("ValutazioneMagazzino_CasiCritici")
        MsgBox "i casi critici da gestire a mano sono visualizzati in tabella"
        
        ' SUBITO METTE IL FLAG DI NECESSARIA GENERAZIONE SUGLI ARTICOLI CHE VERRANNO MODIFICATI
        Dim qdf As QueryDef
        Dim ExecDateTime
        ExecDateTime = Now
        ' nb necessario eseguire codice in quanto risultano query non aggiornabili
        Dim rst As DAO.Recordset
        Dim rstDest As DAO.Recordset
        'Set rst = CurrentDb.OpenRecordset("ValutazioneMagazzino_GenerazioneVALA_ModelItem_FLAGMOD_SELECT")
        Set qdf = CurrentDb.QueryDefs("ValutazioneMagazzino_GenerazioneVALA_ModelItem_FLAGMOD_SELECT")
        qdf.Parameters("[Forms]![principale]![DataCreazioneValoriMagazzino]") = Me.DataCreazioneValoriMagazzino
        Set rst = qdf.OpenRecordset
        If rst.RecordCount > 0 Then
            rst.MoveFirst
            While rst.EOF = False
                Set rstDest = CurrentDb.OpenRecordset("select [Model Item No_],[Model Changed On DateTime] from Item where NO_='" & rst![Model Item No_] & "'")
                rstDest.Edit
                rstDest![Model Changed On DateTime] = ExecDateTime
                rstDest.Update
                rst.MoveNext
            Wend
            rstDest.Close
            rst.Close
        End If
        ' PRIMA SI DEVE ESEGUIRE VAL B. PARTE DAGLI ARTICOLI CHE NON HANNO ALCUNO VAL A E CREA APPLICANDO LA SVALUTAZIONE
        ' MODEL ITEM
        Set qdf = CurrentDb.QueryDefs("ValutazioneMagazzino_GenerazioneVALB_ModelItem")
        qdf.Parameters("[Forms]![principale]![DataCreazioneValoriMagazzino]") = Me.DataCreazioneValoriMagazzino
        qdf.Parameters("[Forms![principale]![TassoDiCambioValutazioneMagazzino]") = Me.TassoDiCambioValutazioneMagazzino
        qdf.Parameters("[Forms]![principale]![PercentualeSvalutazioneVALB]") = Me.PercentualeSvalutazioneVALB
        qdf.Execute
        
        
        ' POI SI ESEGUE VAL A. SEMPRE DA ARTICOLI CHE AL MOMENTO NON HANNO ALCUN VAL A PRESENTE
        ' MODEL ITEM
        Set qdf = CurrentDb.QueryDefs("ValutazioneMagazzino_GenerazioneVALA_ModelItem")
        qdf.Parameters("[Forms]![principale]![DataCreazioneValoriMagazzino]") = Me.DataCreazioneValoriMagazzino
        qdf.Parameters("[Forms![principale]![TassoDiCambioValutazioneMagazzino]") = Me.TassoDiCambioValutazioneMagazzino
        qdf.Execute
        
        DoCmd.Hourglass False
        MsgBox "Crezione Completata"
    
    Else
        MsgBox "Privilegio non sufficiente"
    End If


End Sub

GO

-- Form_Principale:1610-1612
/* Private Sub TastoCreditoOrdiniConProblemi_Click */
Private Sub TastoCreditoOrdiniConProblemi_Click()
    DoCmd.OpenQuery "AnalisiCredito-step0bis-controlloDatiVenditeConProblemi", acViewNormal, acReadOnly
End Sub

GO

-- Form_Principale:1614-1620
/* Private Sub TastoCrossReferenceCrea_Click */
Private Sub TastoCrossReferenceCrea_Click()
    DoCmd.Hourglass True
    CurrentDb.Execute "CreaCrossReferenceFGF"
    MsgBox "Import Completato. Eseguire Controllo"
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:1622-1624
/* Private Sub TastoCrossReferenceVerificaFinale_Click */
Private Sub TastoCrossReferenceVerificaFinale_Click()
    DoCmd.OpenQuery "VerifcaCrossReferenceFGF", acViewNormal, acReadOnly
End Sub

GO

-- Form_Principale:1626-1628
/* Private Sub TastoCrossReferenceVerificaPreventina_Click */
Private Sub TastoCrossReferenceVerificaPreventina_Click()
    DoCmd.OpenQuery "ValidazionePreventivaCrossReferenceFGF", acViewNormal, acReadOnly
End Sub

GO

-- Form_Principale:1630-1643
/* Private Sub TastoDatiPerPackingLiist_Click */
Private Sub TastoDatiPerPackingLiist_Click()
    Dim FiltroStagione As Boolean
    If Me.FiltroStagioneSovraccolli <> "" Or IsNull(Me.FiltroStagioneSovraccolli) = False Then
        MsgBox "Attenzione: Filtro stagione attivo"
        FiltroStagione = True
    End If
    
    If FiltroStagione = True Then
        DoCmd.OpenQuery "LettureTxtDatiPerPivot_filtrostagione", acViewNormal, acReadOnly
    Else
        DoCmd.OpenQuery "LettureTxtDatiPerPivot", acViewNormal, acReadOnly
    End If

End Sub

GO

-- Form_Principale:1645-1657
/* Private Sub TastoDatiPerPackingLiist_UPC_Click */
Private Sub TastoDatiPerPackingLiist_UPC_Click()
    Dim FiltroStagione As Boolean
    If Me.FiltroStagioneSovraccolli <> "" Or IsNull(Me.FiltroStagioneSovraccolli) = False Then
        MsgBox "Attenzione: Filtro stagione attivo"
        FiltroStagione = True
    End If
    
    If FiltroStagione = True Then
        DoCmd.OpenQuery "LettureTxtDatiPerPivot_UPC_filtrostagione", acViewNormal, acReadOnly
    Else
        DoCmd.OpenQuery "LettureTxtDatiPerPivot_UPC", acViewNormal, acReadOnly
    End If
End Sub

GO

-- Form_Principale:1659-1669
/* Private Sub TastoDDTApertiECommentiOrdini_Click */
Private Sub TastoDDTApertiECommentiOrdini_Click()
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-DDTApertiECommenti-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "DDTApertiPerVerificaSblocchiDaIncassi", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:1671-1691
/* Private Sub TastoDettaglioTrasporti_Click */
Private Sub TastoDettaglioTrasporti_Click()
    If livelloUtente >= 1 Then
        If DataIniziale.Value = "" Or IsNull(DataIniziale) = True Or DataFinale.Value = "" Or IsNull(DataFinale) = True Then
            MsgBox "Inserire periodo"
            Exit Sub
        End If
        DoCmd.Hourglass True
    
        Dim exportFileName As String
        exportFileName = nomeAzienda & "-AnalisiTrasportatori-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "AnalisiTrasportatori", exportFileName, True
        DoCmd.Hourglass False
        MsgBox "Estrazione Completata"
    
    Else
        MsgBox "Privilegio non sufficiente"
    End If

End Sub

GO

-- Form_Principale:1693-1699
/* Private Sub TastoEanDoppi_Click */
Private Sub TastoEanDoppi_Click()
    DoCmd.Hourglass True
    MsgBox "Attenzione se il numero di recordo supera 65536 non sono copiabili su excel fino versione 2003"
    DoCmd.OpenQuery "CrossReferenceDoppi", acViewNormal, acReadOnly
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:1701-1753
/* Private Sub tastoEANEtichetteODT_Click */
Private Sub tastoEANEtichetteODT_Click()
    MsgBox "Attenzione stampare su cutepdf e da qui inviare alla stampante per una corretta impaginazione"
    
    If IsNull(Me.FiltroODTEAN) Or Me.FiltroODTEAN = "" Then
        MsgBox "Inserire filtro Ordine di Trasferimento"
        Exit Sub
    End If
    DoCmd.Hourglass True
    
    Dim n As Integer
    Dim rstTmp As DAO.Recordset
    Dim rstEti As DAO.Recordset
    Dim strQry As String
    Dim qdf As QueryDef
    
    Set qdf = CurrentDb.QueryDefs("NavisionEAN-EtichetteODT")
    qdf.Parameters("[Forms!principale!FiltroODTEAN]") = Me.FiltroODTEAN
    
    'Set rstTmp = CurrentDb.OpenRecordset("select * from [NavisionEAN-EtichetteODT] where [document no_]='" & Me.FiltroODTEAN.Value & "'")
    Set rstTmp = qdf.OpenRecordset
    
    
    CurrentDb.Execute ("delete from EANCodeLabelsTMP")
    Set rstEti = CurrentDb.OpenRecordset("EANCodeLabelsTMP")
    If rstTmp.EOF = False Then
        rstTmp.MoveFirst
        While rstTmp.EOF = False
            For n = 1 To rstTmp!qty
                rstEti.AddNew
                rstEti!EANCode = rstTmp!EANCode
                rstEti!UPCCode = rstTmp!UPCCode
                rstEti!Article = rstTmp!Article
                rstEti!Color = rstTmp!Color
                rstEti!Size = rstTmp!Size
                rstEti!ColorDescription = rstTmp!ColorDescription
                rstEti![Description 2] = rstTmp![Description 2]
               
                rstEti.Update
            Next n
            rstTmp.MoveNext
        Wend
    End If
    rstTmp.Close
    rstEti.Close
    DoCmd.Hourglass False
    
    If Me.FlagEtichettaUPC = False Then
        DoCmd.OpenReport "Etichette EANCodeLabelsTMP", acViewPreview, acReadOnly
    Else
        DoCmd.OpenReport "Etichette EANCodeLabelsTMP_con UPC", acViewPreview, acReadOnly
    End If

End Sub

GO

-- Form_Principale:1755-1772
/* Private Sub tastoEANFAtt_Click */
Private Sub tastoEANFAtt_Click()
    DoCmd.Hourglass True
    If IsNull(Me.FiltroEANFatt) Or Me.FiltroEANFatt = "" Then
        MsgBox "Inserire filtro Fattura"
        Exit Sub
    End If
        
    CurrentDb.Execute "delete from saleslinetmp"
    Dim qdf As QueryDef
    Set qdf = CurrentDb.QueryDefs("CreaRigheSalesLineTMPFiltroFatt")
    qdf.Parameters("[Forms]![Principale]![FiltroEanFatt]") = Me.FiltroEANFatt
    qdf.Execute
    ' non eseguibile va in errore per too few parameters
    'CurrentDb.Execute "CreaRigheSalesLineTMPFiltroODV"
    DoCmd.OpenQuery "NavisionEAN-Fatt", acViewNormal, acReadOnly
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:1774-1791
/* Private Sub tastoEANODA_Click */
Private Sub tastoEANODA_Click()
    DoCmd.Hourglass True
    If IsNull(Me.filtroODAEAN) Or Me.filtroODAEAN = "" Then
        MsgBox "Inserire filtro Ordine di Acquisto"
        Exit Sub
    End If
        
    CurrentDb.Execute "delete from saleslinetmp"
    Dim qdf As QueryDef
    Set qdf = CurrentDb.QueryDefs("CreaRigheSalesLineTMPFiltroODA")
    qdf.Parameters("[Forms]![Principale]![FiltroODAEan]") = Me.filtroODAEAN
    qdf.Execute
    ' non eseguibile va in errore per too few parameters
    'CurrentDb.Execute "CreaRigheSalesLineTMPFiltroODV"
    DoCmd.OpenQuery "NavisionEAN-ODA", acViewNormal, acReadOnly
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:1793-1810
/* Private Sub tastoEANODT_Click */
Private Sub tastoEANODT_Click()
    DoCmd.Hourglass True
    If IsNull(Me.FiltroODTEAN) Or Me.FiltroODTEAN = "" Then
        MsgBox "Inserire filtro Ordine di Trasferimento"
        Exit Sub
    End If
        
    CurrentDb.Execute "delete from saleslinetmp"
    Dim qdf As QueryDef
    Set qdf = CurrentDb.QueryDefs("CreaRigheSalesLineTMPFiltroODT")
    qdf.Parameters("[Forms]![Principale]![FiltroODTEan]") = Me.FiltroODTEAN
    qdf.Execute
    ' non eseguibile va in errore per too few parameters
    'CurrentDb.Execute "CreaRigheSalesLineTMPFiltroODV"
    DoCmd.OpenQuery "NavisionEAN-ODT", acViewNormal, acReadOnly
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:1812-1828
/* Private Sub tastoEanODV_Click */
Private Sub tastoEanODV_Click()
    If IsNull(Me.FiltroODVEAN) Or Me.FiltroODVEAN = "" Then
        MsgBox "Inserire filtro Ordine di Vendita"
        Exit Sub
    End If
    DoCmd.Hourglass True
        
    CurrentDb.Execute "delete from saleslinetmp"
    Dim qdf As QueryDef
    Set qdf = CurrentDb.QueryDefs("CreaRigheSalesLineTMPFiltroODV")
    qdf.Parameters("[Forms]![Principale]![FiltroODVEan]") = Me.FiltroODVEAN
    qdf.Execute
    ' non eseguibile va in errore per too few parameters
    'CurrentDb.Execute "CreaRigheSalesLineTMPFiltroODV"
    DoCmd.OpenQuery "NavisionEAN-ODV", acViewNormal, acReadOnly
    DoCmd.Hourglass False
End Sub

GO

-- Form_Principale:1830-1840
/* Private Sub tastoEanStagione_Click */
Private Sub tastoEanStagione_Click()
    DoCmd.Hourglass True
    If IsNull(Me.FiltroStagioneEAN) Or Me.FiltroStagioneEAN = "" Then
        MsgBox "Inserire filtro stagione"
        DoCmd.Hourglass False
        Exit Sub
    End If

    DoCmd.OpenQuery "NavisionEAN-Stagione", acViewNormal, acReadOnly
    DoCmd.Hourglass False
End Sub

GO

-- Form_Principale:1842-1848
/* Private Sub TastoEANTutti_Click */
Private Sub TastoEANTutti_Click()
    DoCmd.Hourglass True
    MsgBox "Attenzione se il numero di recordo supera 65536 non sono copiabili su excel fino versione 2003"
    DoCmd.OpenQuery "NavisionEAN-StagioneTutte", acViewNormal, acReadOnly
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:1850-1867
/* Private Sub TastoEcommerceSinergia_Click */
Private Sub TastoEcommerceSinergia_Click()
    If IsNull(Me.FiltroODVEAN) Or Me.FiltroODVEAN = "" Then
        MsgBox "Inserire filtro Ordine di Vendita"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-EstrazioneECommerce-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "EstrazioneStep6", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"
End Sub

GO

-- Form_Principale:1869-1883
/* Private Sub TastoEcommerceStatisticheVenduto_Click */
Private Sub TastoEcommerceStatisticheVenduto_Click()
    MsgBox "Depositare il file aggiornato Export_Sales_Report nella cartella X:\Ecommerce_SalesReport"
  
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-StatisticaECommerce-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    'exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ItemMasterData", exportFileName, True
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "StatisticheEcommerce", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:1885-1887
/* Private Sub TastoEsci_Click */
Private Sub TastoEsci_Click()
    DoCmd.Quit
End Sub

GO

-- Form_Principale:1889-1905
/* Private Sub TastoEsportaAnalisiApepazza_Click */
Private Sub TastoEsportaAnalisiApepazza_Click()
    ' sistemazione selezione marchio
    Dim oItem As Variant
    Dim i As Integer
    For i = 0 To Me.FiltroMarchioMultiSelezione.ListCount - 1
        If Me.FiltroMarchioMultiSelezione.ItemData(i) = "AP" Then
            Me.FiltroMarchioMultiSelezione.Selected(i) = True
        Else
            Me.FiltroMarchioMultiSelezione.Selected(i) = False
        End If
    Next
    
    Me.FiltroMarchioTipo = 1
    
    EstrazioneStatisticheGenericaPerStagione "EstrazioneShooseAndCo", "AnalisiVenditeApepazza", "having"
    
End Sub

GO

-- Form_Principale:1907-1909
/* Private Sub TastoEsportaAnalisiComprato_Click */
Private Sub TastoEsportaAnalisiComprato_Click()
    EstrazioneStatisticheGenericaPerStagione "def01-PurchasePortFolio", "PurchasePortfolio", "where"
End Sub

GO

-- Form_Principale:1911-1914
/* Private Sub TastoEsportaAnalisiCompratoTaglia_Click */
Private Sub TastoEsportaAnalisiCompratoTaglia_Click()
    EstrazioneStatisticheGenericaPerStagione "def01-PurchasePortFolioItem", "PurchasePortfolioItem", "where"

End Sub

GO

-- Form_Principale:1916-1973
/* Private Sub TastoEsportaAnalisiSku_Click */
Private Sub TastoEsportaAnalisiSku_Click()
    
    ' AAA DA MARZO 2022 CONTA SOLO LA QUERY qSoloVendNoFiltri, PERCHE' PER OTTIMIZZARE FUNZIONA METTENDO IL FILTRO FISSO MARCHIO E SE DEL CASO AGENTE O CLIENTE
    ' QUINDI OTTIMIZZAZIONE CON FILTRO SU QUERY PRIMA DEL JOIN
    ' UNA SOLA QUERY DI PARTENZA MODIFICATA DINAMICAMENTE
        
    Dim qdf1 As QueryDef, qdf2 As QueryDef
        
    Set qdf1 = CurrentDb.QueryDefs("AnalisiCancellazioniSKU_step0_dativendite")
    Set qdf2 = CurrentDb.QueryDefs("AnalisiCancellazioniSKU_step0_dativendite_NOFILTRI")
    qdf1.SQL = qdf2.SQL
        
    ' verifica che almeno una stagione sia selezionata
    If Me.FiltroStagioneMultiSelezione.ItemsSelected.count = 0 Then
        MsgBox "Selezionare almeno una stagione"
        Exit Sub
    End If

    ' verifica che un marchio sia selezionato, se la modalità è marchio singolo
    If Me.FiltroMarchioTipo = 1 Then 'singolo marchio
        Dim i As Integer
        Dim contato As Integer
        contato = 0
        For i = 0 To Me.FiltroMarchioMultiSelezione.ListCount - 1
            If Me.FiltroMarchioMultiSelezione.Selected(i) = True Then contato = contato + 1
        Next
        If contato = 0 Then
            MsgBox "Selezionare un marchio"
            Exit Sub
        End If
    End If
    
    DoCmd.Hourglass True

    sistemaFiltroStagioneMarchio
    
    Dim filtroStringa As String
    filtroStringa = Forms!principale.FiltroStagioneMarchioCalcolato
    ' e necessario sul marchio sostituire a solo TRADE
    
    'rimozione ";"
    qdf1.SQL = Left$(qdf1.SQL, InStr(qdf1.SQL, ";") - 1)
    'aggiunta filtro stagione e marchio (where o having)
    ' ESSENDO CHE LA QUERY HA GIà IN PARTENZA HAVING SI AGGIUNGE UN "AND"
    qdf1.SQL = qdf1.SQL & " " & "AND" & " " & filtroStringa
    ' aaaa sistemare filtro cliente o agente e nome file
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-" & "AnalisiCancellazioniSKUs" & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00") & "-(" & FiltroStagioneMarchioPerNomeFile & ")"
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "AnalisiCancellazioniSKUs", exportFileName, True
    
        
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"
    

End Sub

GO

-- Form_Principale:1975-2040
/* Private Sub TastoEsportaAnalisiVenduto_Click */
Private Sub TastoEsportaAnalisiVenduto_Click()
    
    ' AAA DA MARZO 2022 CONTA SOLO LA QUERY qSoloVendNoFiltri, PERCHE' PER OTTIMIZZARE FUNZIONA METTENDO IL FILTRO FISSO MARCHIO E SE DEL CASO AGENTE O CLIENTE
    ' QUINDI OTTIMIZZAZIONE CON FILTRO SU QUERY PRIMA DEL JOIN
    ' UNA SOLA QUERY DI PARTENZA MODIFICATA DINAMICAMENTE
        
    Dim qdf1 As QueryDef, qdf2 As QueryDef
        
    Set qdf1 = CurrentDb.QueryDefs("qSoloVend")
    Set qdf2 = CurrentDb.QueryDefs("qSoloVendNoFiltri")
    qdf1.SQL = qdf2.SQL
        
    ' verifica che almeno una stagione sia selezionata
    If Me.FiltroStagioneMultiSelezione.ItemsSelected.count = 0 Then
        MsgBox "Selezionare almeno una stagione"
        Exit Sub
    End If

    ' verifica che un marchio sia selezionato, se la modalità è marchio singolo
    If Me.FiltroMarchioTipo = 1 Then 'singolo marchio
        Dim i As Integer
        Dim contato As Integer
        contato = 0
        For i = 0 To Me.FiltroMarchioMultiSelezione.ListCount - 1
            If Me.FiltroMarchioMultiSelezione.Selected(i) = True Then contato = contato + 1
        Next
        If contato = 0 Then
            MsgBox "Selezionare un marchio"
            Exit Sub
        End If
    End If
    
    DoCmd.Hourglass True

    sistemaFiltroStagioneMarchio
    
    Dim filtroStringa As String
    filtroStringa = Forms!principale.FiltroStagioneMarchioCalcolato
    ' e necessario sul marchio sostituire a solo TRADE
    
    'aggiunge se del caso filtro cliente o agente
    If Me.FiltroClienteAnalisi <> "" Or IsNull(Me.FiltroClienteAnalisi) = False Then
        filtroStringa = filtroStringa & " and [sales header.Sell-to customer no_]='" & Me.FiltroClienteAnalisi & "' "
        FiltroStagioneMarchioPerNomeFile = FiltroStagioneMarchioPerNomeFile & "_" & Me.FiltroClienteAnalisi
    ElseIf Me.FiltroAgenteAnalisi <> "" Or IsNull(Me.FiltroAgenteAnalisi) = False Then
        filtroStringa = filtroStringa & " and [Sales Header.Salesperson code]='" & Me.FiltroAgenteAnalisi & "'"
        FiltroStagioneMarchioPerNomeFile = FiltroStagioneMarchioPerNomeFile & "_" & Me.FiltroAgenteAnalisi
    End If

    
    'rimozione ";"
    qdf1.SQL = Left$(qdf1.SQL, InStr(qdf1.SQL, ";") - 1)
    'aggiunta filtro stagione e marchio (where o having)
    qdf1.SQL = qdf1.SQL & " " & "WHERE" & " " & filtroStringa
    ' aaaa sistemare filtro cliente o agente e nome file
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-" & "AnalisiVendite" & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00") & "-(" & FiltroStagioneMarchioPerNomeFile & ")"
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "def01-analisivenduto-pivot", exportFileName, True
    
        
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"
        
End Sub

GO

-- Form_Principale:2042-2059
/* Private Sub TastoEsportaAnalisiVendutoItem_Click */
Private Sub TastoEsportaAnalisiVendutoItem_Click()
    Dim qdf1 As QueryDef, qdf2 As QueryDef
    If Me.FiltroClienteAnalisi <> "" Or IsNull(Me.FiltroClienteAnalisi) = False Then
        Set qdf1 = CurrentDb.QueryDefs("qSoloVendItem")
        Set qdf2 = CurrentDb.QueryDefs("qSoloVendItemConFiltroCliente")
        qdf1.SQL = qdf2.SQL
    ElseIf Me.FiltroAgenteAnalisi <> "" Or IsNull(Me.FiltroAgenteAnalisi) = False Then
        Set qdf1 = CurrentDb.QueryDefs("qSoloVendItem")
        Set qdf2 = CurrentDb.QueryDefs("qSoloVendItemConFiltroAgente")
        qdf1.SQL = qdf2.SQL
    Else
        Set qdf1 = CurrentDb.QueryDefs("qSoloVendItem")
        Set qdf2 = CurrentDb.QueryDefs("qSoloVendItemNoFiltri")
        qdf1.SQL = qdf2.SQL
    End If
    
    EstrazioneStatisticheGenericaPerStagione "def01-ANALISIVENDUTOITEM-PIVOT", "AnalisiVenditeItem", "where"
End Sub

GO

-- Form_Principale:2061-2079
/* Private Sub TastoEsportaConfrontoStagioni_Click */
Private Sub TastoEsportaConfrontoStagioni_Click()
    Dim qdf1 As QueryDef, qdf2 As QueryDef
    Set qdf1 = CurrentDb.QueryDefs("qSoloVend")
    Set qdf2 = CurrentDb.QueryDefs("qSoloVendNoFiltri")
    qdf1.SQL = qdf2.SQL
    
    
    ' test preventivi e messaggio di attenzione
    If Me.FiltroConfrontoStagione1 = "" Or IsNull(Me.FiltroConfrontoStagione1) = True Or Me.FiltroConfrontoStagione2 = "" Or IsNull(Me.FiltroConfrontoStagione2) = True Or Me.DataCutoffStagione1 = "" Or IsNull(Me.DataCutoffStagione1) = True Or Me.DataCutoffStagione2 = "" Or IsNull(Me.DataCutoffStagione2) = True Then
        MsgBox "Inserire stagioni di confronto e relative date di cutoff"
        Exit Sub
    End If
    
    Dim RES As Integer
    RES = MsgBox("Attenzione verificare le le stagioni da confrontare siano presenti nel filtro principale", vbYesNo)
    
    If RES = 6 Then EstrazioneStatisticheGenericaPerStagione "def01-ANALISIVENDUTO-ConfrontoStagioni", "AnalisiVendite-ConfrontoStagioni", "where"
        
End Sub

GO

-- Form_Principale:2081-2091
/* Private Sub TastoEsportaConfrontoStagioniItem_Click */
Private Sub TastoEsportaConfrontoStagioniItem_Click()
    ' test preventivi e messaggio di attenzione
    If Me.FiltroConfrontoStagione1 = "" Or IsNull(Me.FiltroConfrontoStagione1) = True Or Me.FiltroConfrontoStagione2 = "" Or IsNull(Me.FiltroConfrontoStagione2) = True Or Me.DataCutoffStagione1 = "" Or IsNull(Me.DataCutoffStagione1) = True Or Me.DataCutoffStagione2 = "" Or IsNull(Me.DataCutoffStagione2) = True Then
        MsgBox "Inserire stagioni di confronto e relative date di cutoff"
        Exit Sub
    End If
    Dim RES As Integer
    RES = MsgBox("Attenzione verificare le le stagioni da confrontare siano presenti nel filtro principale", vbYesNo)
    If RES = 6 Then EstrazioneStatisticheGenericaPerStagione "def01-ANALISIVENDUTOITEM-ConfrontoStagioni", "AnalisiVenditeItem-ConfrontoStagioni", "where"

End Sub

GO

-- Form_Principale:2093-2106
/* Private Sub TastoEsportaControlloEAN_Click */
Private Sub TastoEsportaControlloEAN_Click()
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-ControlloImportEAN-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "EAN_ControlloPostImport", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:2108-2121
/* Private Sub TastoEsportaControlloUPC_Click */
Private Sub TastoEsportaControlloUPC_Click()
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-ControlloImportUPC-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "UPC_ControlloPostImport", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:2123-2142
/* Private Sub TastoEsportaEntrateUsciteMagazzino_Click */
Private Sub TastoEsportaEntrateUsciteMagazzino_Click()
    If Me.FiltroStagioneSourcing = "" Or IsNull(Me.FiltroStagioneSourcing) = True Then
        MsgBox "Inserire la stagione"
        Exit Sub
    End If
    

    Dim exportFileName As String
    exportFileName = nomeAzienda & "-EmtrateUsciteMagazzino-(" & Me.FiltroStagioneSourcing & ")-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "Movimenti_PMAG_SPMAG", exportFileName, True

    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

    DoCmd.Hourglass False


End Sub

GO

-- Form_Principale:2144-2146
/* Private Sub TastoEsportaForecast_Click */
Private Sub TastoEsportaForecast_Click()
    EstrazioneStatisticheGenericaPerStagione "ForecastBudget-PerEstrazione", "BudgetForecast", "where"
End Sub

GO

-- Form_Principale:2148-2151
/* Private Sub TastoEsportaSituazioneRicevimenti_Click */
Private Sub TastoEsportaSituazioneRicevimenti_Click()
    EstrazioneStatisticheGenericaPerStagione "SituazioneRicevimenti", "SituazioneRicevimenti", "where"

End Sub

GO

-- Form_Principale:2153-2161
/* Private Sub TastoEsportaVendutoComprato_Click */
Private Sub TastoEsportaVendutoComprato_Click()
    If IsNull(Forms!principale!FattoreCorrettivo) = True Then
        MsgBox ("Selezionare un fattore correttivo")
        Exit Sub
    End If
    
    EstrazioneStatisticheGenericaPerStagione "def01-qAcqEVend-ZFinal-PerAnalisi-MoreData", "AnalisiVendutoComprato", "where"

End Sub

GO

-- Form_Principale:2163-2170
/* Private Sub TastoEsportaVendutoCompratoItem_Click */
Private Sub TastoEsportaVendutoCompratoItem_Click()
    If IsNull(Forms!principale!FattoreCorrettivo) = True Then
        MsgBox ("Selezionare un fattore correttivo")
        Exit Sub
    End If
    
    EstrazioneStatisticheGenericaPerStagione "def01-qAcqEVend-Item-ZFinal-PerAnalisi", "AnalisiVendutoCompratoItem", "where"
End Sub

GO

-- Form_Principale:2172-2182
/* Private Sub TastoEstraiCoin_Click */
Private Sub TastoEstraiCoin_Click()
    If IsNull(Me.FiltroODVEAN) Or Me.FiltroODVEAN = "" Then
        MsgBox "Inserire filtro Ordine di Vendita"
        Exit Sub
    End If
    DoCmd.Hourglass True
        
    DoCmd.OpenQuery "EstraiDatiCoin", acViewNormal, acReadOnly
    DoCmd.Hourglass False
    
End Sub

GO

-- Form_Principale:2185-2200
/* Private Sub TastoEstraiConaiGermania_Click */
Private Sub TastoEstraiConaiGermania_Click()
    If livelloUtente >= 1 Then
        DoCmd.Hourglass True
        Dim exportFileName As String
        exportFileName = nomeAzienda & "-DatiConaiGermania-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ConaiTedesco_step0_Fatture", exportFileName, True
    
        DoCmd.Hourglass False
        MsgBox "Estrazione Completata"
    
    Else
        MsgBox "Privilegio non sufficiente"
    End If

End Sub

GO

-- Form_Principale:2202-2223
/* Private Sub TastoestraiconsegnePronte_Click */
Private Sub TastoestraiconsegnePronte_Click()
    Dim qdf1 As QueryDef, qdf2 As QueryDef
    Me.FiltroClienteAnalisi = ""
    Set qdf1 = CurrentDb.QueryDefs("qSoloVendItem")
    Set qdf2 = CurrentDb.QueryDefs("qSoloVendItemConFiltroCliente")
    qdf1.SQL = qdf2.SQL
    
    If IsNull(Me.FiltroClienteEAN) Or Me.FiltroClienteEAN = "" Or IsNull(Me.FiltroStagioneEAN2) Or Me.FiltroStagioneEAN2 = "" Then
        MsgBox "Inserire filtro Cliente e Codice Stagione"
        Exit Sub
    End If
    Me.FiltroClienteAnalisi = Me.FiltroClienteEAN
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-ConsegnePronte-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ConsegnePronte", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:2225-2246
/* Private Sub TastoEstraiControlloTaglieAssortimenti_Click */
Private Sub TastoEstraiControlloTaglieAssortimenti_Click()
    
    If IsNull(Me.FiltroStagioneEAN) Or Me.FiltroStagioneEAN = "" Then
        MsgBox "Inserire filtro stagione"
        DoCmd.Hourglass False
        Exit Sub
    End If
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-CoperturaAssortimenti-(" & Me.FiltroStagioneEAN & ")-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    'exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ItemMasterData", exportFileName, True
    
    
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "CoperturaAssortimenti", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:2248-2274
/* Private Sub TastoEstraiCrossReferenceClienti_Click */
Private Sub TastoEstraiCrossReferenceClienti_Click()
    
    If IsNull(Me.FiltroStagioneEAN) Or Me.FiltroStagioneEAN = "" Then
        MsgBox "Inserire filtro stagione"
        DoCmd.Hourglass False
        Exit Sub
    End If
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-Clienti con Cross Reference Summary-(" & Me.FiltroStagioneEAN & ")-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    'exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ItemMasterData", exportFileName, True
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "dam_lista clienti con cross reference per stagione_summary", exportFileName, True
    
    exportFileName = nomeAzienda & "-Clienti con Cross Reference Detail-(" & Me.FiltroStagioneEAN & ")-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    'exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ItemMasterData", exportFileName, True
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "dam_lista clienti con cross reference per stagione_detail", exportFileName, True

    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:2276-2295
/* Private Sub TastoEstraiDDTPerAgente_Click */
Private Sub TastoEstraiDDTPerAgente_Click()
    If Me.DataInizialeExportDDT.Value = "" Or IsNull(Me.DataInizialeExportDDT) = True Or Me.DataFinaleExportDDT.Value = "" Or IsNull(Me.DataFinaleExportDDT) = True Or Me.FiltroAgenteExportDDT = "" Or IsNull(Me.FiltroAgenteExportDDT) = True Then
        MsgBox "Inserire periodo e codice agente"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-DDTPerPeriodoAgente-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "DDTPeriodoAgente", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"


End Sub

GO

-- Form_Principale:2297-2315
/* Private Sub TastoEstraiDDTPerDataCreazione_Click */
Private Sub TastoEstraiDDTPerDataCreazione_Click()
    If Me.DataInizialeExportDDT.Value = "" Or IsNull(Me.DataInizialeExportDDT) = True Or Me.DataFinaleExportDDT.Value = "" Or IsNull(Me.DataFinaleExportDDT) = True Then
        MsgBox "Inserire periodo"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-DDTPerDataRegistrazione-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "DDTPerDataCreazione", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:2317-2336
/* Private Sub TastoEstraiDDTPerDataRegistrazione_Click */
Private Sub TastoEstraiDDTPerDataRegistrazione_Click()
    If Me.DataInizialeExportDDT.Value = "" Or IsNull(Me.DataInizialeExportDDT) = True Or Me.DataFinaleExportDDT.Value = "" Or IsNull(Me.DataFinaleExportDDT) = True Then
        MsgBox "Inserire periodo"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-DDTPerDataRegistrazione-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "DDTPerDataRegistrazione", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"


End Sub

GO

-- Form_Principale:2338-2366
/* Private Sub TastoEstraiDisponibileKimo_Click */
Private Sub TastoEstraiDisponibileKimo_Click()
    If Me.FiltroMarchioSourcing = "" Or IsNull(Me.FiltroMarchioSourcing) = True Or Me.FiltroStagioneSourcing = "" Or IsNull(Me.FiltroStagioneSourcing) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
    ' accodamento record
    'Dim QDF As QueryDef
    'Set QDF = CurrentDb.QueryDefs("CalcoloDisponibilITA")
    'QDF.Parameters("MARCHIO") = Me.FiltroMarchioSourcing
    'QDF.Parameters("STAGIONE") = Me.FiltroStagioneSourcing


    ' estrazione tabella
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-CalcolaDisponibile-(" & Me.FiltroStagioneSourcing & "_" & Me.FiltroMarchioSourcing & ")-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "cALCOLODISPONIBILITA", exportFileName, True

    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

  

    ' EstrazioneStatisticheGenericaPerStagione "VendutoCompratoProiezione", "VendutoCompratoProiezione", "where"
    DoCmd.Hourglass False
End Sub

GO

-- Form_Principale:2368-2397
/* Private Sub TastoEstraiDisponibileSfusoKimo_Click */
Private Sub TastoEstraiDisponibileSfusoKimo_Click()
    If Me.FiltroMarchioSourcing = "" Or IsNull(Me.FiltroMarchioSourcing) = True Or Me.FiltroStagioneSourcing = "" Or IsNull(Me.FiltroStagioneSourcing) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
    ' accodamento record
    'Dim QDF As QueryDef
    'Set QDF = CurrentDb.QueryDefs("CalcoloDisponibilITA")
    'QDF.Parameters("MARCHIO") = Me.FiltroMarchioSourcing
    'QDF.Parameters("STAGIONE") = Me.FiltroStagioneSourcing


    ' estrazione tabella
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-CalcolaDisponibileSfuso-(" & Me.FiltroStagioneSourcing & "_" & Me.FiltroMarchioSourcing & ")-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "cALCOLODISPONIBILITAitem", exportFileName, True

    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

  

    ' EstrazioneStatisticheGenericaPerStagione "VendutoCompratoProiezione", "VendutoCompratoProiezione", "where"
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:2399-2430
/* Private Sub TastoEstraiDisponibileSfusoPerStock_Click */
Private Sub TastoEstraiDisponibileSfusoPerStock_Click()
    If Me.FiltroMarchioSourcing = "" Or IsNull(Me.FiltroMarchioSourcing) = True Or Me.FiltroStagioneSourcing = "" Or IsNull(Me.FiltroStagioneSourcing) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    
    MsgBox "Attenzione il disponibile per Stock non tiene conto di acquisti e trasferimenti e considera i soli ordini di vendita di tipo Stock"
    
    DoCmd.Hourglass True
    ' accodamento record
    'Dim QDF As QueryDef
    'Set QDF = CurrentDb.QueryDefs("CalcoloDisponibilITA")
    'QDF.Parameters("MARCHIO") = Me.FiltroMarchioSourcing
    'QDF.Parameters("STAGIONE") = Me.FiltroStagioneSourcing


    ' estrazione tabella
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-CalcolaDisponibileSfusoPerStock-(" & Me.FiltroStagioneSourcing & "_" & Me.FiltroMarchioSourcing & ")-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "cALCOLODISPONIBILITAitemPerStock", exportFileName, True

    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

  

    ' EstrazioneStatisticheGenericaPerStagione "VendutoCompratoProiezione", "VendutoCompratoProiezione", "where"
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:2432-2473
/* Private Sub TastoEstraiFoto_Click */
Private Sub TastoEstraiFoto_Click()
    'DoCmd.OpenQuery "ListaFotoODV"
    DoCmd.Hourglass True
    Dim L As Long
    Dim fldr As String
    Dim fs As FileSystemObject
    Dim curPath As String
    Randomize
    L = Int((1000000 * Rnd) + 1)
    
    
    'ChDir Me.PercorsoSalvataggio & nomeAzienda & "\FOTOORDINI_CANCELLARESUBITO"
    'ChDrive "\\donald"
    'curPath = CurDir
    
    Set fs = CreateObject("Scripting.FileSystemObject")
    fldr = "Foto_" & "_" & SubstSlashDash(Me.FiltroODVEAN) & "_" & Format$(L, "0000000")
    
    Dim SERVER_PATH As String
    SERVER_PATH = Me.PercorsoSalvataggio & nomeAzienda & "\FOTOORDINI_CANCELLARESUBITO\"
    Dim folderPath As String
    folderPath = SERVER_PATH & fldr

    With fs
        If Not .FolderExists(folderPath) Then .CreateFolder folderPath
    End With
    
    Dim rst As DAO.Recordset
    Dim qdf As QueryDef
    Set qdf = CurrentDb.QueryDefs("ListaFotoODV")
    qdf.Parameters("Forms!Principale!FiltroODVEAN") = Me.FiltroODVEAN
    Set rst = qdf.OpenRecordset
    If rst.RecordCount > 0 Then
        rst.MoveFirst
        While rst.EOF = False
            FileCopy rst![Linked Document], folderPath & "\" & fs.GetFileName(rst![Linked Document])
            rst.MoveNext
        Wend
    End If
    DoCmd.Hourglass False
    MsgBox "Foto estratte in " & folderPath
End Sub

GO

-- Form_Principale:2475-2490
/* Private Sub TastoEstraiGenerica_Click */
Private Sub TastoEstraiGenerica_Click()
    DoCmd.Hourglass True
    Dim exportFileName As String
    Dim RES As String
    RES = InputBox("Tabella o Query da estrarre")
    exportFileName = nomeAzienda & "-" & RES & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, RES, exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:2492-2545
/* Private Sub TastoEstraiLogimoda_Click */
Private Sub TastoEstraiLogimoda_Click()
    ' verifica che almeno una stagione sia selezionata
    If Me.FiltroStagioneLogimoda.ItemsSelected.count = 0 Then
        MsgBox "Selezionare almeno una stagione"
        Exit Sub
    End If
    If Me.FiltroMarchioLogimoda.ItemsSelected.count = 0 Then
        MsgBox "Selezionare almeno un marchio"
        Exit Sub
    End If

 
    sistemaFiltroStagioneMarchioLogimoda

    ' estrazione articoli
    Dim qdfTemp As QueryDef
    Dim qdfTempName As String
    qdfTempName = Now
    Set qdfTemp = CurrentDb.CreateQueryDef(qdfTempName)
    qdfTemp.SQL = CurrentDb.QueryDefs("Logimoda_EstrazioneArticoli").SQL
    'rimozione ";"
    qdfTemp.SQL = Left$(qdfTemp.SQL, InStr(qdfTemp.SQL, ";") - 1)
    'aggiunta filtro stagione e marchio (where o having)
    qdfTemp.SQL = qdfTemp.SQL & " and " & Forms!principale.FiltroStagioneMarchioCalcolato
    

    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-" & "LogimodaArticoli" & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00") & "-(" & FiltroStagioneMarchioPerNomeFile & ")"
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, qdfTemp.Name, exportFileName, True
    
    CurrentDb.QueryDefs.Delete qdfTemp.Name
    
    ' estrazione gruppi variabili taglia
    exportFileName = nomeAzienda & "-LogimodaGruppiVariabiliTaglia-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "Logimoda_EstrazioneCodiciGruppiVariabiliTaglia", exportFileName, True
    
    
    ' estrazione gruppi assortimenti
    exportFileName = nomeAzienda & "-LogimodaAssortimenti-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "Logimoda_EstrazioniAssortimenti", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"


    
End Sub

GO

-- Form_Principale:2547-2567
/* Private Sub TastoEstraiORdiniCliente_Click */
Private Sub TastoEstraiORdiniCliente_Click()
    Dim qdf1 As QueryDef, qdf2 As QueryDef
    Me.FiltroClienteAnalisi = ""
    Set qdf1 = CurrentDb.QueryDefs("qSoloVendItem")
    Set qdf2 = CurrentDb.QueryDefs("qSoloVendItemConFiltroCliente")
    qdf1.SQL = qdf2.SQL
    
    If IsNull(Me.FiltroClienteEAN) Or Me.FiltroClienteEAN = "" Or IsNull(Me.FiltroStagioneEAN2) Or Me.FiltroStagioneEAN2 = "" Then
        MsgBox "Inserire filtro Cliente e Codice Stagione"
        Exit Sub
    End If
    Me.FiltroClienteAnalisi = Me.FiltroClienteEAN
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-OrdiniCliente-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "OrdiniClienteItem", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"
End Sub

GO

-- Form_Principale:2569-2578
/* Private Sub TastoEstraiPackingList_Click */
Private Sub TastoEstraiPackingList_Click()
    ' Test campi compilati
    If IsNull(Me.FiltroDDT) Or Me.FiltroDDT = "" Then
        MsgBox "Inserire il numero della spedizione registrata"
        Exit Sub
    End If
    DoCmd.OpenQuery "PackingList", acViewNormal, acReadOnly
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:2580-2594
/* Private Sub TastoEstraiPerControlliLince_Click */
Private Sub TastoEstraiPerControlliLince_Click()
    If Me.CreditoFiltroStagione1 = "" Or IsNull(Me.CreditoFiltroStagione1) = True Or Me.CreditoFiltroStagione2 = "" Or IsNull(Me.CreditoFiltroStagione2) = True Or Me.ControlloNumeroGiorniScadenzaLince = "" Or IsNull(Me.ControlloNumeroGiorniScadenzaLince) = True Then
        MsgBox "Inserire le due stagioni da analizzare e il numero giorni scadenza"
        Exit Sub
    End If
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-DatiCreditoELince-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "AnalisiCredito", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:2596-2616
/* Private Sub TastoEstraiSpedizioniClienteStagione_Click */
Private Sub TastoEstraiSpedizioniClienteStagione_Click()
    If IsNull(Me.FiltroStagioneEAN2) Or Me.FiltroStagioneEAN2 = "" Or IsNull(Me.FiltroClienteEAN) = True Or Me.FiltroClienteEAN = "" Then
        MsgBox "Inserire filtro stagione e cliente"
        DoCmd.Hourglass False
        Exit Sub
    End If
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-SituazioneSpedizioniCliente-(" & Me.FiltroStagioneEAN2 & "_" & Me.FiltroClienteEAN & ")-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    'exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ItemMasterData", exportFileName, True
    
    
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "SituazioneSpedizioniCliente", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:2618-2633
/* Private Sub TastoEstraiVociDoganali_Click */
Private Sub TastoEstraiVociDoganali_Click()
      
    If IsNull(Me.FiltroClienteEAN) Or Me.FiltroClienteEAN = "" Or IsNull(Me.FiltroStagioneEAN2) Or Me.FiltroStagioneEAN2 = "" Then
        MsgBox "Inserire filtro Cliente e Codice Stagione"
        Exit Sub
    End If
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-VociDoganali_" & Me.FiltroClienteEAN & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "EstrazioneVociDoganaliDaSPD", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:2635-2659
/* Private Sub TastoEstrazioneAnagraficheSfusoDBG_Click */
Private Sub TastoEstrazioneAnagraficheSfusoDBG_Click()
    If Me.FiltroMarchioSourcing = "" Or IsNull(Me.FiltroMarchioSourcing) = True Or Me.FiltroStagioneSourcing = "" Or IsNull(Me.FiltroStagioneSourcing) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
 

    ' estrazione tabella
    Dim exportFileName As String
    Dim exportfilenamecsv As String
    
    exportFileName = nomeAzienda & "-AnagraficaDBGSfuso-(" & Me.FiltroStagioneSourcing & "_" & Me.FiltroMarchioSourcing & ")-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    exportfilenamecsv = Me.PercorsoSalvataggio & nomeAzienda & "\ANAGRAFICA [" & Me.FiltroStagioneSourcing & "].csv"
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "dbgroup anagrafica sfuso", exportFileName, True
    
    'FIORELLINI
    'DoCmd.TransferText acExportDelim, "ANAGRAFICHE SFUSO - specifica di collegamento", "dbgroup anagrafica sfuso", exportfilenamecsv, True
    'DoCmd.TransferText acExportDelim, "ANAGRAFICHE SFUSO - specifica di collegamento", "dbgroup anagrafica sfuso", Me.PercorsoSalvataggio & nomeAzienda & "\ANAGRAFICA.csv", True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"
  
End Sub

GO

-- Form_Principale:2661-2674
/* Private Sub TastoEstrazioneControlloLogimoda_Click */
Private Sub TastoEstrazioneControlloLogimoda_Click()
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-GiacenzaAssortimentoControlloNAVLogimoda-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ConfrontoGiacenzaLogimoda", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:2676-2694
/* Private Sub TastoEstrazioneControloQuadrature_Click */
Private Sub TastoEstrazioneControloQuadrature_Click()
    If DataFinale.Value = "" Or IsNull(DataFinale) = True Or DataIniziale.Value = "" Or IsNull(DataIniziale) = True Then
            MsgBox "Inserire data iniziale e finale"
            Exit Sub
    End If
        
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-QuadraturaRicaviDaPDC_Fatt e NDC" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "RicercaperBollofatturazioneeltrronicadifferenze-FATTNDC_REG PDC", exportFileName, True
    
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"


End Sub

GO

-- Form_Principale:2696-2715
/* Private Sub TastoEstrazioneDatiIntrastat_Click */
Private Sub TastoEstrazioneDatiIntrastat_Click()
    If livelloUtente >= 1 Then
        If DataIniziale.Value = "" Or IsNull(DataIniziale) = True Or DataFinale.Value = "" Or IsNull(DataFinale) = True Then
            MsgBox "Inserire periodo"
            Exit Sub
        End If
        DoCmd.Hourglass True
        Dim exportFileName As String
        exportFileName = nomeAzienda & "-DatiIntrastatVendite-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "Intrastat", exportFileName, True
    
        DoCmd.Hourglass False
        MsgBox "Estrazione Completata"
    
    Else
        MsgBox "Privilegio non sufficiente"
    End If
    
End Sub

GO

-- Form_Principale:2717-2736
/* Private Sub TastoEstrazioneDatiIntrastatAcquisti_Click */
Private Sub TastoEstrazioneDatiIntrastatAcquisti_Click()
    If livelloUtente >= 1 Then
        If DataIniziale.Value = "" Or IsNull(DataIniziale) = True Or DataFinale.Value = "" Or IsNull(DataFinale) = True Then
            MsgBox "Inserire periodo"
            Exit Sub
        End If
        DoCmd.Hourglass True
        Dim exportFileName As String
        exportFileName = nomeAzienda & "-DatiIntrastatAcquisti-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "IntrastatAcquisti", exportFileName, True
    
        DoCmd.Hourglass False
        MsgBox "Estrazione Completata"
    
    Else
        MsgBox "Privilegio non sufficiente"
    End If

End Sub

GO

-- Form_Principale:2738-2751
/* Private Sub TastoEstrazioneDatiLince_Click */
Private Sub TastoEstrazioneDatiLince_Click()
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-DatiLince-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "EstrazioneDatiLince", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:2753-2785
/* Private Sub TastoEstrazioneDisponibilePreRun_Click */
Private Sub TastoEstrazioneDisponibilePreRun_Click()
    
    DoCmd.Hourglass True
    ' accodamento record
    'Dim QDF As QueryDef
    'Set QDF = CurrentDb.QueryDefs("CalcoloDisponibilITA")
    'QDF.Parameters("MARCHIO") = Me.FiltroMarchioSourcing
    'QDF.Parameters("STAGIONE") = Me.FiltroStagioneSourcing

    MsgBox "Attenzione. Estrae solo da alcuni ordini di acquisto per specifici assortimenti e considera solo il venduto con flag fast shipment sugli ordini di vendita"
    
    ' estrazione tabella
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-DisponibilePreRun-(" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "GestioneDisponibilitPreRun_03_Final", exportFileName, True
    
    exportFileName = nomeAzienda & "-DisponibilePreRun-PerAgenti-(" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "GestioneDisponibilitPreRun_03_Final_PerAgenti", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

  

    ' EstrazioneStatisticheGenericaPerStagione "VendutoCompratoProiezione", "VendutoCompratoProiezione", "where"
    DoCmd.Hourglass False


End Sub

GO

-- Form_Principale:2787-2803
/* Private Sub TastoEstrazioneElCorteIngles_Click */
Private Sub TastoEstrazioneElCorteIngles_Click()
    If Me.FiltroSPdElCorteIngles = "" Or IsNull(Me.FiltroSPdElCorteIngles) Then
        MsgBox "inserire filtro spd"
        Exit Sub
    End If
        
    DoCmd.Hourglass True
    CreaDatiPerFatturaElCorteInglesDaDDT (Me.FiltroSPdElCorteIngles.Value)
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-ElCorteIngles-" & "-" & Me.FiltroSPdElCorteIngles.Value & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "DatiElCorteIngles", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:2805-2821
/* Private Sub TastoEstrazioneInboundSfusoDBG_Click */
Private Sub TastoEstrazioneInboundSfusoDBG_Click()
    DoCmd.Hourglass True
 

    ' estrazione tabella
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-InboundDBGSfuso"
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "dbgroup inbound sfuso", exportFileName, True

    'FIORELLINI
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:2823-2913
/* Private Sub tastoEstrazionePayline_Click */
Private Sub tastoEstrazionePayline_Click()
    ' estrae le posizioni aperte chiuse e la lista clienti per payline
    If livelloUtente >= 1 Then
        If Me.DataIniziale = "" Or IsNull(Me.DataIniziale) = True Or Me.DataFinale = "" Or IsNull(Me.DataFinale) = True Or Me.DataPagamentoPosizioniScoperte = "" Or IsNull(Me.DataPagamentoPosizioniScoperte) = True Or Me.NumeroGiorniSoglia = "" Or IsNull(Me.NumeroGiorniSoglia) = True Then
            MsgBox "Inserire periodo, data pagamento posizioni scoperte e numero giorni soglia (pagamento e ritardo)"
            Exit Sub
        End If
        
        'DA ABILITARE NEL CASO SI USASSERO TABELLE DI APPOGGIO TEMPORANEE
        Dim RES As Integer
        RES = MsgBox("Attenzione deve essere eseguita da un utente per volta. Procedere?", vbYesNo)
        If RES <> 6 Then Exit Sub
        
        DoCmd.Hourglass True
    
        ' BLOCCO USATO PER AVERE COME APPOGGIO LE TABELLE; QUESTA ESECUZIONE E' PIù VELOCE ME IMPLICA USO DI TABELLE TEMPORANEE CON POTENZIALI PROBLEMI SUL FILE ACCESS
        Dim qdf As QueryDef
        CurrentDb.Execute "delete from Payline_Export_Structure_Partite"
        Set qdf = CurrentDb.QueryDefs("tempiPag_New_step9a_CervedPayline_Aperte")
        qdf.Parameters("[Forms!principale!DataPagamentoPosizioniScoperte]") = Me.DataPagamentoPosizioniScoperte
        qdf.Execute
        
        Dim tbl As TableDef
        
        Dim exportFileName As String
        ' aperte xlsx
        exportFileName = nomeAzienda & "-PaylineAperte-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
        'nel caso di esportazione diretta
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "tempiPag_New_step9a_CervedPayline_Aperte", exportFileName, True
        'NEL CASO DI TABELLE TEMPORANTEE
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "Payline_Export_Structure_Partite", exportFileName, True
        ' aperte txt
        exportFileName = "m35793" & Format$(Year(Now), "0000") & Format$(Month(Now), "00") & "A"
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".txt"
        ' I TRANSFERTEXT DANNO SEMPRE ERRORE SIA CHE SI USI LA SPECIFICA DI ESPORTAZIONE CHE NO; NEL SECONDO CASO PER CASINO SU SEPARTORE CAMPO; NEL PRIMO PER DIMENSIONE CAMPO (BAH)
        'DoCmd.TransferText acExportDelim, , "Payline_Export_Structure_Partite", exportFileName, True
        'DoCmd.TransferText acExportDelim, "Payline_Export_Structure_Partite - specifica di esportazione", "Payline_Export_Structure_Partite", exportFileName, True
        ' nel caso di esportazione che perè non funziona richiededno parametro
        'salvaFileTxt exportFileName, "tempiPag_New_step9a_CervedPayline_Aperte", ";"
        salvaFileTxt exportFileName, "Payline_Export_Structure_Partite", ";"
        
        ' chiuse xlsx
        CurrentDb.Execute "delete from Payline_Export_Structure_Partite"
        Set qdf = CurrentDb.QueryDefs("tempiPag_New_step9b_CervedPayline_Chiuse")
        qdf.Parameters("[Forms!principale!DataPagamentoPosizioniScoperte]") = Me.DataPagamentoPosizioniScoperte
        qdf.Parameters("[Forms!principale!Datainiziale]") = Me.DataIniziale
        qdf.Parameters("[Forms!principale!datafinale]") = Me.DataFinale
        qdf.Execute
        
        exportFileName = nomeAzienda & "-PaylineChiuse-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
        'nel caso di esportazione diretta
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "tempiPag_New_step9b_CervedPayline_Chiuse", exportFileName, True
        'NEL CASO DI TABELLE TEMPORANTEE
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "Payline_Export_Structure_Partite", exportFileName, True
        ' chiuse txt
        exportFileName = "m35793" & Format$(Year(Now), "0000") & Format$(Month(Now), "00") & "C"
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".txt"
        'DoCmd.TransferText acExportDelim, "Payline_Export_Structure_Partite - specifica di esportazione", "tempiPag_New_step9b_CervedPayline_Chiuse", exportFileName, True
        salvaFileTxt exportFileName, "Payline_Export_Structure_Partite", ";"
        
        
        ' clienti xslx
        CurrentDb.Execute "delete from Payline_Export_Structure_Clienti"
        Set qdf = CurrentDb.QueryDefs("tempiPag_New_step9c_CervedPayline_Clienti")
        qdf.Parameters("[Forms!principale!DataPagamentoPosizioniScoperte]") = Me.DataPagamentoPosizioniScoperte
        qdf.Parameters("[Forms!principale!Datainiziale]") = Me.DataIniziale
        qdf.Parameters("[Forms!principale!datafinale]") = Me.DataFinale
        qdf.Execute
        
        exportFileName = nomeAzienda & "-PaylineClienti-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
        'nel caso di esportazione diretta
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "tempiPag_New_step9c_CervedPayline_Clienti", exportFileName, True
        'NEL CASO DI TABELLE TEMPORANTEE
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "Payline_Export_Structure_Clienti", exportFileName, True
        
        'clienti txt
        exportFileName = "c35793" & Format$(Year(Now), "0000") & Format$(Month(Now), "00")
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".txt"
        'DoCmd.TransferText acExportDelim, "Payline_Export_Structure_Clienti - specifica di esportazione", "tempiPag_New_step9c_CervedPayline_Clienti", exportFileName, True
        salvaFileTxt exportFileName, "Payline_Export_Structure_Clienti", ";"
        DoCmd.Hourglass False
        MsgBox "Estrazione Completata"
    
    Else
        MsgBox "Privilegio non sufficiente"
    End If

End Sub

GO

-- Form_Principale:2915-2933
/* Private Sub TastoEstrazionePerFiltroCampagna_Click */
Private Sub TastoEstrazionePerFiltroCampagna_Click()
    If Me.FiltroMarchio = "" Or IsNull(Me.FiltroMarchio) = True Or Me.FiltroStagione = "" Or IsNull(Me.FiltroStagione) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-FiltroCampagna-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00") & "-(" & Me.FiltroMarchio & "_" & Me.FiltroStagione & ")"
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "GraficoMiglioriArticoliVendutiEstrazione", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:2935-2954
/* Private Sub TastoEstrazioneSimulazioneTaglie_Click */
Private Sub TastoEstrazioneSimulazioneTaglie_Click()
    If Me.FiltroMarchioSourcing = "" Or IsNull(Me.FiltroMarchioSourcing) = True Or Me.FiltroStagioneSourcing = "" Or IsNull(Me.FiltroStagioneSourcing) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If


    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-ProiezioneSimulazioneTaglie-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "VendutoCalcoloProiezionePerTaglia", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:2956-2976
/* Private Sub TastoEstrazioneTempiPagamento_Click */
Private Sub TastoEstrazioneTempiPagamento_Click()
    If livelloUtente >= 1 Then
        If Me.DataPagamentoPosizioniScoperte = "" Or IsNull(Me.DataPagamentoPosizioniScoperte) = True Or Me.NumeroGiorniSoglia = "" Or IsNull(Me.NumeroGiorniSoglia) = True Then
            MsgBox "Inserire data pagamento posizioni scoperte e numero giorni soglia (pagamento e ritardo)"
            Exit Sub
        End If
        DoCmd.Hourglass True
    
        Dim exportFileName As String
        exportFileName = nomeAzienda & "-AnalisiTempiPagamento-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "tempiPag_New_step8c_GeneraleFinal", exportFileName, True
        DoCmd.Hourglass False
        MsgBox "Estrazione Completata"
    
    Else
        MsgBox "Privilegio non sufficiente"
    End If

End Sub

GO

-- Form_Principale:2978-2996
/* Private Sub TastoEstrazioneTemplateCPH_Click */
Private Sub TastoEstrazioneTemplateCPH_Click()
    If Me.FiltroODAEstrazioneTemplateNapa = "" Or IsNull(Me.FiltroODAEstrazioneTemplateNapa) = True Then
        MsgBox "Inserire ordine di acquisto"
        Exit Sub
    End If


    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-EstrazioneTemplateCPH-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "Template CPH Ordini Acquisto", exportFileName, True
    
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:2998-3024
/* Private Sub TastoEstrazioneTemplateNapa_Click */
Private Sub TastoEstrazioneTemplateNapa_Click()
    If Me.FiltroODAEstrazioneTemplateNapa = "" Or IsNull(Me.FiltroODAEstrazioneTemplateNapa) = True Then
        MsgBox "Inserire ordine di acquisto"
        Exit Sub
    End If


    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-EstrazioneTemplateNapapijri-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "EstrazioneDatiPerCompilazioneTemplateNapa", exportFileName, True
    
    exportFileName = nomeAzienda & "-EstrazioneTemplateNapapijriGrouped-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "EstrazioneDatiPerCompilazioneTemplateNapa_Grouped", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:3026-3038
/* Private Sub tastoestrazionevenditeaprezzilistino_Click */
Private Sub tastoestrazionevenditeaprezzilistino_Click()
         DoCmd.Hourglass True
    
        Dim exportFileName As String
        exportFileName = nomeAzienda & "-VenditePrezziListino-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "BLAUER_covid_1_ValorizzazioneSpeditoAPrezzoStandard", exportFileName, True
        DoCmd.Hourglass False
        MsgBox "Estrazione Completata"
    

End Sub

GO

-- Form_Principale:3040-3046
/* Private Sub TastoEstrazioneVenditeBridgeOutletFebos_Click */
Private Sub TastoEstrazioneVenditeBridgeOutletFebos_Click()
    DoCmd.Hourglass True

    DoCmd.OpenQuery "EstrazioneDatiVenditeBridgeSpaccioFebos", acViewNormal, acReadOnly
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:3048-3054
/* Private Sub TastoEstrazioneVenditeBridgeOutletFebosDaBolla_Click */
Private Sub TastoEstrazioneVenditeBridgeOutletFebosDaBolla_Click()
    DoCmd.Hourglass True

    DoCmd.OpenQuery "EstrazioneDatiVenditeBridgeSpaccioFebosDaBolla", acViewNormal, acReadOnly
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:3056-3077
/* Private Sub TastoEstrazioneWildberries_Click */
Private Sub TastoEstrazioneWildberries_Click()
    Dim qdf1 As QueryDef, qdf2 As QueryDef
    Me.FiltroClienteAnalisi = ""
    Set qdf1 = CurrentDb.QueryDefs("qSoloVendItem")
    Set qdf2 = CurrentDb.QueryDefs("qSoloVendItemConFiltroCliente")
    qdf1.SQL = qdf2.SQL
    
    If IsNull(Me.FiltroClienteEAN) Or Me.FiltroClienteEAN = "" Or IsNull(Me.FiltroStagioneEAN2) Or Me.FiltroStagioneEAN2 = "" Then
        MsgBox "Inserire filtro Cliente e Codice Stagione"
        Exit Sub
    End If
    Me.FiltroClienteAnalisi = Me.FiltroClienteEAN
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-Wildberries-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "WildeBerries", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:3079-3095
/* Private Sub TastoEstrazioneZalando_Click */
Private Sub TastoEstrazioneZalando_Click()
    DoCmd.Hourglass True
    If IsNull(Me.FiltroEANFatt) Or Me.FiltroEANFatt = "" Then
        MsgBox "Inserire filtro Numero Fattura"
        DoCmd.Hourglass False
        Exit Sub
  
    End If
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-DatiZalandoFattura-" & Me.FiltroEANFatt & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ExportZalando", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:3097-3141
/* Private Sub tastoEtichetteDaFileExcel_Click */
Private Sub tastoEtichetteDaFileExcel_Click()
    MsgBox "Attenzione stampare su cutepdf e da qui inviare alla stampante per una corretta impaginazione"
    MsgBox "Attenzione verificare che il file EtichetteCampioni.xls, formato excel 1997/2003 sia presente nella cartella etichettecampioni e che abbia una cartella 'tutto' con le informazioni presenti"
    DoCmd.Hourglass True
    
    Dim n As Integer
    Dim rstTmp As DAO.Recordset
    Dim rstEti As DAO.Recordset
    Dim strQry As String
    
    Set rstTmp = CurrentDb.OpenRecordset("select * from [etichettecampioni]")
    CurrentDb.Execute ("delete from EANCodeLabelsTMP")
    Set rstEti = CurrentDb.OpenRecordset("EANCodeLabelsTMP")
    If rstTmp.EOF = False Then
        rstTmp.MoveFirst
        While rstTmp.EOF = False
            If Nz(rstTmp![SMS Pairs Order]) = 0 Then
                MsgBox "Inserire la quantità campioni. Controllare se ci sono righe vuote alla fine del file"
                DoCmd.Hourglass False
                Exit Sub
            End If
            For n = 1 To rstTmp![SMS Pairs Order] * 2
                rstEti.AddNew
                rstEti!EANCode = ""
                rstEti!Article = rstTmp![Bridge Style Code]
                rstEti!Color = rstTmp![Bridge Color Code]
                rstEti!Size = rstTmp!Size
                rstEti!ColorDescription = rstTmp![Color Name]
                rstEti![Description 2] = rstTmp![Style Name]
                rstEti.Update
            Next n
            rstTmp.MoveNext
        Wend
    End If
    rstTmp.Close
    rstEti.Close
    DoCmd.Hourglass False
    
    
    DoCmd.OpenReport "EtichetteCampionari", acViewPreview, acReadOnly
    ' AAAA PER STAMPARE ERICHERRA IMPORTATO DA:
    ' DoCmd.OpenReport "EtichettaImportatoDa", acViewPreview, acReadOnly


End Sub

GO

-- Form_Principale:3143-3191
/* Private Sub tastoEtichetteDaFileExcelProduzione_Click */
Private Sub tastoEtichetteDaFileExcelProduzione_Click()
    MsgBox "Attenzione stampare su cutepdf e da qui inviare alla stampante per una corretta impaginazione"
    MsgBox "Attenzione verificare che il file EtichetteCampioni.xls, formato excel 1997/2003 sia presente nella cartella etichettecampioni e che abbia una cartella 'tutto' con le informazioni presenti"
    DoCmd.Hourglass True
    
    Dim n As Integer
    Dim rstTmp As DAO.Recordset
    Dim rstEti As DAO.Recordset
    Dim strQry As String
    
    Set rstTmp = CurrentDb.OpenRecordset("select * from [etichetteproduzionedaexcel]")
    CurrentDb.Execute ("delete from EANCodeLabelsTMP")
    Set rstEti = CurrentDb.OpenRecordset("EANCodeLabelsTMP")
    If rstTmp.EOF = False Then
        rstTmp.MoveFirst
        While rstTmp.EOF = False
            If Nz(rstTmp![SMS Pairs Order]) = 0 Then
                MsgBox "Inserire la quantità campioni. Controllare se ci sono righe vuote alla fine del file"
                DoCmd.Hourglass False
                Exit Sub
            End If
            For n = 1 To rstTmp![SMS Pairs Order]
                rstEti.AddNew
                If Me.FlagEtichettaUPC = True Then
                    rstEti!UPCCode = rstTmp![upcfound]
                Else
                    rstEti!EANCode = rstTmp![eanfound]
                End If
                rstEti!Article = rstTmp![Bridge Style Code]
                rstEti!Color = rstTmp![Bridge Color Code]
                rstEti!Size = rstTmp!Sizedesc
                rstEti!ColorDescription = rstTmp!ColorDescription
                rstEti![Description 2] = rstTmp![Description 2]

                rstEti.Update
            Next n
            rstTmp.MoveNext
        Wend
    End If
    rstTmp.Close
    rstEti.Close
    DoCmd.Hourglass False
    If Me.FlagEtichettaUPC = False Then
        DoCmd.OpenReport "Etichette EANCodeLabelsTMP", acViewPreview, acReadOnly
    Else
        DoCmd.OpenReport "Etichette EANCodeLabelsTMP_con UPC", acViewPreview, acReadOnly
    End If

End Sub

GO

-- Form_Principale:3193-3259
/* Private Sub tastoEtichetteEANODA_Click */
Private Sub tastoEtichetteEANODA_Click()
    MsgBox "Attenzione stampare su cutepdf e da qui inviare alla stampante per una corretta impaginazione"
    If IsNull(Me.filtroODAEAN) Or Me.filtroODAEAN = "" Then
        MsgBox "Inserire filtro Ordine di Acquisto"
        Exit Sub
    End If
    DoCmd.Hourglass True
    
    Dim n As Integer
    Dim rstTmp As DAO.Recordset
    Dim rstEti As DAO.Recordset
    Dim strQry As String
    Dim qdf As QueryDef
    
    Set qdf = CurrentDb.QueryDefs("NavisionEAN-EtichetteODA")
    qdf.Parameters("[Forms!principale!FiltroODAEAN]") = Me.filtroODAEAN
    
    'Set rstTmp = CurrentDb.OpenRecordset("select * from [NavisionEAN-EtichetteODA] where [document no_]='" & Me.filtroODAEAN.Value & "'")
    Set rstTmp = qdf.OpenRecordset
    

    CurrentDb.Execute ("delete from EANCodeLabelsTMP")
    Set rstEti = CurrentDb.OpenRecordset("EANCodeLabelsTMP")
    If rstTmp.EOF = False Then
        rstTmp.MoveFirst
        While rstTmp.EOF = False
            Dim numeroetichette As Integer
            If Me.ParametroDivisoreNumeroEtichette > 0 Then
                numeroetichette = Round(rstTmp!qty / Me.ParametroDivisoreNumeroEtichette)
            Else
                numeroetichette = rstTmp!qty
            End If
            For n = 1 To numeroetichette
                rstEti.AddNew
                rstEti!EANCode = rstTmp!EANCode
                rstEti!UPCCode = rstTmp!UPCCode
                rstEti!Article = rstTmp!Article
                rstEti!Color = rstTmp!Color
                rstEti!Size = rstTmp!Size
                rstEti!ColorDescription = rstTmp!ColorDescription
                rstEti![Description 2] = rstTmp![Description 2]
                rstEti.Update
            Next n
            rstTmp.MoveNext
        Wend
    End If
    rstTmp.Close
    rstEti.Close
    DoCmd.Hourglass False
                
    If Me.filtrolineaean = "" Or IsNull(Me.filtrolineaean) = True Then
        'MsgBox ""
        If Me.FlagEtichettaUPC = False Then
            DoCmd.OpenReport "Etichette EANCodeLabelsTMP", acViewPreview, acReadOnly
        Else
            DoCmd.OpenReport "Etichette EANCodeLabelsTMP_con UPC", acViewPreview, acReadOnly
        End If
    Else
        'MsgBox ""
        If Me.FlagEtichettaUPC = False Then
            DoCmd.OpenReport "Etichette EANCodeLabelsTMP", acViewPreview, acReadOnly, "[line code]='" & Me.filtrolineaean & "'"
        Else
            DoCmd.OpenReport "Etichette EANCodeLabelsTMP_con UPC", acViewPreview, acReadOnly, "[line code]='" & Me.filtrolineaean & "'"
        End If
    End If

End Sub

GO

-- Form_Principale:3261-3319
/* Private Sub tastoEtichetteEANODAOrizz_Click */
Private Sub tastoEtichetteEANODAOrizz_Click()
    MsgBox "Attenzione stampare su cutepdf e da qui inviare alla stampante per una corretta impaginazione"
    If IsNull(Me.filtroODAEAN) Or Me.filtroODAEAN = "" Then
        MsgBox "Inserire filtro Ordine di Acquisto"
        Exit Sub
    End If
    DoCmd.Hourglass True
    
    Dim n As Integer
    Dim rstTmp As DAO.Recordset
    Dim rstEti As DAO.Recordset
    Dim strQry As String
    Dim qdf As QueryDef
    
    Set qdf = CurrentDb.QueryDefs("NavisionEAN-EtichetteODA")
    qdf.Parameters("[Forms!principale!FiltroODAEAN]") = Me.filtroODAEAN
    
    'Set rstTmp = CurrentDb.OpenRecordset("select * from [NavisionEAN-EtichetteODA] where [document no_]='" & Me.filtroODAEAN.Value & "'")
    Set rstTmp = qdf.OpenRecordset
    

    CurrentDb.Execute ("delete from EANCodeLabelsTMP")
    Set rstEti = CurrentDb.OpenRecordset("EANCodeLabelsTMP")
    If rstTmp.EOF = False Then
        rstTmp.MoveFirst
        While rstTmp.EOF = False
            Dim numeroetichette As Integer
            If Me.ParametroDivisoreNumeroEtichette > 0 Then
                numeroetichette = Round(rstTmp!qty / Me.ParametroDivisoreNumeroEtichette)
            Else
                numeroetichette = rstTmp!qty
            End If
            For n = 1 To numeroetichette
                rstEti.AddNew
                rstEti!EANCode = rstTmp!EANCode
                rstEti!UPCCode = rstTmp!UPCCode
                rstEti!Article = rstTmp!Article
                rstEti!Color = rstTmp!Color
                rstEti!Size = rstTmp!Size
                rstEti!ColorDescription = rstTmp!ColorDescription
                rstEti![Description 2] = rstTmp![Description 2]
                rstEti.Update
            Next n
            rstTmp.MoveNext
        Wend
    End If
    rstTmp.Close
    rstEti.Close
    DoCmd.Hourglass False
            
    
    If Me.filtrolineaean = "" Or IsNull(Me.filtrolineaean) = True Then
        DoCmd.OpenReport "Etichette EANCodeLabelsTMP_Orizz", acViewPreview, acReadOnly
    
    Else
            DoCmd.OpenReport "Etichette EANCodeLabelsTMP_Orizz", acViewPreview, acReadOnly, "[line code]='" & Me.filtrolineaean & "'"
    End If

End Sub

GO

-- Form_Principale:3321-3371
/* Private Sub tastoEtichetteEANODV_Click */
Private Sub tastoEtichetteEANODV_Click()
    MsgBox "Attenzione stampare su pdfcreator cutepdf e da qui inviare alla stampante per una corretta impaginazione"
    If IsNull(Me.FiltroODVEAN) Or Me.FiltroODVEAN = "" Then
        MsgBox "Inserire filtro Ordine di Vendita"
        Exit Sub
    End If
    DoCmd.Hourglass True
    
    Dim n As Integer
    Dim rstTmp As DAO.Recordset
    Dim rstEti As DAO.Recordset
    Dim strQry As String
    Dim qdf As QueryDef
    
    If Me.FlagUnaEtichettaPerAssortimento = True Then
        Set qdf = CurrentDb.QueryDefs("NavisionEAN-EtichetteODV_UnoPerAssortimento")
    Else
        Set qdf = CurrentDb.QueryDefs("NavisionEAN-EtichetteODV")
    End If
    qdf.Parameters("[Forms!principale!FiltroODVEAN]") = Me.FiltroODVEAN
    
    'Set rstTmp = CurrentDb.OpenRecordset("select * from [NavisionEAN-EtichetteODV]")
    Set rstTmp = qdf.OpenRecordset
    CurrentDb.Execute ("delete from EANCodeLabelsTMP")
    Set rstEti = CurrentDb.OpenRecordset("EANCodeLabelsTMP")
    If rstTmp.EOF = False Then
        rstTmp.MoveFirst
        While rstTmp.EOF = False
            For n = 1 To rstTmp!qty
                rstEti.AddNew
                rstEti!EANCode = rstTmp!EANCode
                rstEti!UPCCode = rstTmp!UPCCode
                rstEti!Article = rstTmp!Article
                rstEti!Color = rstTmp!Color
                rstEti!Size = rstTmp!Size
                rstEti!ColorDescription = rstTmp!ColorDescription
                rstEti![Description 2] = rstTmp![Description 2]
                rstEti.Update
            Next n
            rstTmp.MoveNext
        Wend
    End If
    rstTmp.Close
    rstEti.Close
    DoCmd.Hourglass False
    If Me.FlagEtichettaUPC = False Then
        DoCmd.OpenReport "Etichette EANCodeLabelsTMP", acViewPreview, acReadOnly
    Else
        DoCmd.OpenReport "Etichette EANCodeLabelsTMP_con UPC", acViewPreview, acReadOnly
    End If
End Sub

GO

-- Form_Principale:3373-3444
/* Private Sub TastoEtichetteScatolaFGF_Click */
Private Sub TastoEtichetteScatolaFGF_Click()
    MsgBox "Attenzione stampare su cutepdf e da qui inviare alla stampante per una corretta impaginazione"
    If IsNull(Me.NumeroSPD) Or Me.NumeroSPD = "" Then
        MsgBox "Inserire filtro SPD"
        Exit Sub
    End If
    DoCmd.Hourglass True
    
    Dim n As Integer
    Dim rstTmp As DAO.Recordset
    Dim rstEti As DAO.Recordset
    Dim strQry As String
    Dim qdf As QueryDef
    
    Set qdf = CurrentDb.QueryDefs("NavisionEAN-EtichetteFGF_SPD")
    qdf.Parameters("[Forms!principale!NUMEROSPD]") = Me.NumeroSPD
    
    Set rstTmp = qdf.OpenRecordset
    

    CurrentDb.Execute ("delete from EANCodeLabelsTMP")
    Set rstEti = CurrentDb.OpenRecordset("EANCodeLabelsTMP")
    If rstTmp.EOF = False Then
        rstTmp.MoveFirst
        While rstTmp.EOF = False
            Dim numeroetichette As Integer
            numeroetichette = rstTmp!qty
            
            For n = 1 To numeroetichette
                rstEti.AddNew
                rstEti!EANCode = rstTmp!EANCode
                rstEti!UPCCode = rstTmp!UPCCode
                rstEti!Article = rstTmp!Article
                
                Dim p As Integer, inpu As String
                inpu = rstTmp![Cross-Reference No_]
                ' si parte dal presupposto che ci siano due underscore, il primo per separare codice e parte il secondo per il colore

                Dim codiceFGF As String, parteFGF As String, coloreFGF As String
                p = InStr(inpu, "_")
                If p > 1 Then
                    codiceFGF = Left$(inpu, p - 1)
                    inpu = Right$(inpu, Len(inpu) - p)
                End If
                p = InStr(inpu, "_")
                If p > 1 Then
                    parteFGF = Left$(inpu, p - 1)
                    coloreFGF = Right$(inpu, Len(inpu) - p)
                End If
        
    
                ' il colore deve rimanere quello originale, perchè la query nei dati report la usa per determinare il percorso della immagine
                ' il report è poi modificato per far vedere solo la colorDescription e l'immagine è messa come visible NO
                rstEti!Color = rstTmp!Color
                rstEti!Size = rstTmp!Size
                ' mettere colore FGF
                rstEti!ColorDescription = coloreFGF
                ' mettere qui il codice e la parte di FGF
                ' rstEti![Description 2] = rstTmp![Description 2]
                rstEti![Description 2] = codiceFGF & " " & parteFGF
                rstEti.Update
            Next n
            rstTmp.MoveNext
        Wend
    End If
    rstTmp.Close
    rstEti.Close
    DoCmd.Hourglass False
                
    DoCmd.OpenReport "Etichette EANCodeLabelsTMP_FGF", acViewPreview, acReadOnly

End Sub

GO

-- Form_Principale:3446-3495
/* Private Sub TastoEtichetteScatolaQuelloGiusto_Click */
Private Sub TastoEtichetteScatolaQuelloGiusto_Click()
    MsgBox "Attenzione stampare su cutepdf e da qui inviare alla stampante per una corretta impaginazione"
    If IsNull(Me.NumeroSPD) Or Me.NumeroSPD = "" Then
        MsgBox "Inserire filtro SPD"
        Exit Sub
    End If
    DoCmd.Hourglass True
    
    Dim n As Integer
    Dim rstTmp As DAO.Recordset
    Dim rstEti As DAO.Recordset
    Dim strQry As String
    Dim qdf As QueryDef
    
    Set qdf = CurrentDb.QueryDefs("NavisionEAN-EtichetteQuelloGiusto_SPD")
    qdf.Parameters("[Forms!principale!NUMEROSPD]") = Me.NumeroSPD
    
    Set rstTmp = qdf.OpenRecordset
    

    CurrentDb.Execute ("delete from EANCodeLabelsTMP")
    Set rstEti = CurrentDb.OpenRecordset("EANCodeLabelsTMP")
    If rstTmp.EOF = False Then
        rstTmp.MoveFirst
        While rstTmp.EOF = False
            Dim numeroetichette As Integer
            numeroetichette = rstTmp!qty
            
            For n = 1 To numeroetichette
                rstEti.AddNew
                rstEti!EANCode = rstTmp!EANCode
                rstEti!UPCCode = rstTmp!UPCCode
                rstEti!Article = rstTmp!Article
                
                rstEti!Color = rstTmp!Color
                rstEti!Size = rstTmp!Size
                rstEti!ColorDescription = rstTmp!Color
                rstEti.Update
            Next n
            rstTmp.MoveNext
        Wend
    End If
    rstTmp.Close
    rstEti.Close
    DoCmd.Hourglass False
                
    DoCmd.OpenReport "Etichette EANCodeLabelsTMP_QuelloGiusto", acViewPreview, acReadOnly


End Sub

GO

-- Form_Principale:3552-3570
/* Private Sub TastoExportColiPerCPH_Click */
Private Sub TastoExportColiPerCPH_Click()
    If Me.FiltroMarchioSourcing = "" Or IsNull(Me.FiltroMarchioSourcing) = True Or Me.FiltroStagioneSourcing = "" Or IsNull(Me.FiltroStagioneSourcing) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    

    Dim exportFileName As String
    exportFileName = nomeAzienda & "-CPH_SEASONAL_BOXES-(" & Me.FiltroStagioneSourcing & "_" & Me.FiltroMarchioSourcing & ")-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "QC_Final_CPH BOXES", exportFileName, True

    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:3572-3590
/* Private Sub TastoExportColiPerQC_Click */
Private Sub TastoExportColiPerQC_Click()
    If Me.FiltroMarchioSourcing = "" Or IsNull(Me.FiltroMarchioSourcing) = True Or Me.FiltroStagioneSourcing = "" Or IsNull(Me.FiltroStagioneSourcing) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    

    Dim exportFileName As String
    exportFileName = nomeAzienda & "-DatiQC-(" & Me.FiltroStagioneSourcing & "_" & Me.FiltroMarchioSourcing & ")-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "QC_Final", exportFileName, True

    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:3592-3595
/* Private Sub TastoFabbisognoMaterialiPerODA_Click */
Private Sub TastoFabbisognoMaterialiPerODA_Click()
    DoCmd.OpenQuery "Materiali-ODA", acViewNormal, acReadOnly

End Sub

GO

-- Form_Principale:3598-3600
/* Private Sub TastoFattureEDdt_Click */
Private Sub TastoFattureEDdt_Click()

End Sub

GO

-- Form_Principale:3602-3620
/* Private Sub TastoFattureEndcRegistrate_Click */
Private Sub TastoFattureEndcRegistrate_Click()
    If DataIniziale.Value = "" Or IsNull(DataIniziale) = True Or DataFinale.Value = "" Or IsNull(DataFinale) = True Then
        MsgBox "Inserire periodo"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-FattureENdcRegistrate-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "FattureENdcRegistrate ", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:3622-3640
/* Private Sub TastoFattureEndcRegistrateAcquisti_Click */
Private Sub TastoFattureEndcRegistrateAcquisti_Click()
    If DataIniziale.Value = "" Or IsNull(DataIniziale) = True Or DataFinale.Value = "" Or IsNull(DataFinale) = True Then
        MsgBox "Inserire periodo"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-FattureENdcRegistrateAcquisti-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "FattureENdcRegistrateAcquisti ", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:3642-3659
/* Private Sub TastoFatturePerClientePerido_Click */
Private Sub TastoFatturePerClientePerido_Click()
    If IsNull(Me.FiltroClienteEAN) Or Me.FiltroClienteEAN = "" Or Me.DataInizialeExportDDT.Value = "" Or IsNull(Me.DataInizialeExportDDT) = True Or Me.DataFinaleExportDDT.Value = "" Or IsNull(Me.DataFinaleExportDDT) = True Then
        MsgBox "Inserire periodo e codice cliente"
        Exit Sub
    End If

    DoCmd.Hourglass True
  
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-FatturaVenditaPeriodo-" & Me.FiltroClienteEAN & "-" & Me.FiltroEANFatt & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ExportFatturaVenditaPerClente", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"


End Sub

GO

-- Form_Principale:3661-3680
/* Private Sub TastoFattureRegistrateEDdt_Click */
Private Sub TastoFattureRegistrateEDdt_Click()
    If DataIniziale.Value = "" Or IsNull(DataIniziale) = True Or DataFinale.Value = "" Or IsNull(DataFinale) = True Then
        MsgBox "Inserire periodo"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-FattureRegistrateEDdt-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "FattureRegistrateEDdt", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"


End Sub

GO

-- Form_Principale:3682-3700
/* Private Sub TastoFattureRegistrateEDdt_nonfatturati_Click */
Private Sub TastoFattureRegistrateEDdt_nonfatturati_Click()
    If DataIniziale.Value = "" Or IsNull(DataIniziale) = True Or DataFinale.Value = "" Or IsNull(DataFinale) = True Then
        MsgBox "Inserire periodo"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-FattureRegistrateEDdt-NON fatturato-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "FattureRegistrateEDdt-solononfatturato", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:3702-3715
/* Private Sub TastoFattureTemporaneeEDdt_Click */
Private Sub TastoFattureTemporaneeEDdt_Click()
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-FattureTemporaneeEDdt-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "FattureTemporaneeEDdt", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:3717-3756
/* Private Sub TastoGenera_Click */
Private Sub TastoGenera_Click()
    If Me.NumeroSovraccolli < 0 Or IsNull(Me.NumeroSovraccolli) Then
        MsgBox "inserire il numero sovraccolli da generare"
        Exit Sub
    End If
    Dim rstDest As DAO.Recordset
    CurrentDb.Execute ("delete * from tabellaappoggio")
    Set rstDest = CurrentDb.OpenRecordset("TabellaAppoggio")
    Dim i As Integer
    For i = 1 To Me.NumeroSovraccolli
        rstDest.AddNew
        rstDest!numeroBPR = Me.numeroBPR
       
        rstDest!CodiceCliente = Me.CodiceCliente
        rstDest!DescrizioneCliente1 = Me.DescrizioneCliente1
        rstDest!DescrizioneCliente2 = Me.DescrizioneCliente2
        rstDest!IndirizzoCliente1 = Me.IndirizzoCliente1
        rstDest!IndirizzoCliente2 = Me.IndirizzoCliente2
        rstDest!CapCliente = Me.CapCliente
        rstDest!CittaCliente = Me.CittaCliente
        rstDest!ProvinciaCliente = Me.ProvinciaCliente
        rstDest!PaeseCliente = Me.PaeseCliente
        rstDest!CodiceDestino = Me.CodiceDestino
        rstDest!DescrizioneDestino1 = Me.DescrizioneDestino1
        rstDest!DescrizioneDestino2 = Me.DescrizioneDestino2
        rstDest!IndirizzoDestino1 = Me.IndirizzoDestino1
        rstDest!IndirizzoDestino2 = Me.IndirizzoDestino2
        rstDest!CapDestino = Me.CapDestino
        rstDest!CittaDestino = Me.CittaDestino
        rstDest!ProvinciaDestino = Me.ProvinciaDestino
        rstDest!PaeseDestino = Me.PaeseDestino
        rstDest!ReferenzaOrdineCliente = Me.ReferenzaOrdine
        rstDest!RiferimentoOrdineCliente = Me.RiferimentoOrdine
        
        rstDest.Update
    Next i
    rstDest.Close
    DoCmd.OpenReport "reportok", acViewPreview

End Sub

GO

-- Form_Principale:3758-3909
/* Private Sub TastoGeneraDaLetture_Click */
Private Sub TastoGeneraDaLetture_Click()
    MsgBox "Attenzione il report sovraccolli usa sempre il filtro stagione per selezionare eventuali carry over con lo stesso EAN/UPC su diversi articoli. Il numero totale paia potrebbe quindi essere inferiore al numero totale delle letture"
    If Me.FiltroStagioneSovraccolli = "" Or IsNull(Me.FiltroStagioneSovraccolli) = True Then
        MsgBox "Inserire filtro stagione"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
    Dim rstDest As DAO.Recordset
    Dim rstOri As DAO.Recordset
    
    Dim i As Integer
    
    Dim maxArticoli As Integer
    maxArticoli = 12
    
    Dim qdf As QueryDef
    Set qdf = CurrentDb.QueryDefs("SovraccolliDaLetture")
    qdf.Parameters("[Forms!principale!filtrostagionesovraccolli]") = Me.FiltroStagioneSovraccolli

    Set rstOri = qdf.OpenRecordset
    'Set rstOri = CurrentDb.OpenRecordset("SovraccolliDaLetture")
    CurrentDb.Execute ("delete * from TabellaAppoggioSovraccolliDaLetture")
    Set rstDest = CurrentDb.OpenRecordset("TabellaAppoggioSovraccolliDaLetture")
    Dim overload As Boolean
    overload = False
    Dim currentBox As Integer
    currentBox = 0
    Dim pezziNelBox As Integer
    pezziNelBox = 0
    If rstOri.RecordCount > 0 Then
        rstOri.MoveFirst
        currentBox = rstOri!CARTONE
        pezziNelBox = 1
        While rstOri.EOF = False
            rstDest.AddNew
            rstDest!numeroBPR = Me.numeroBPR
            rstDest!CodiceCliente = Me.CodiceCliente
            rstDest!DescrizioneCliente1 = Me.DescrizioneCliente1
            rstDest!DescrizioneCliente2 = Me.DescrizioneCliente2
            rstDest!IndirizzoCliente1 = Me.IndirizzoCliente1
            rstDest!IndirizzoCliente2 = Me.IndirizzoCliente2
            rstDest!CapCliente = Me.CapCliente
            rstDest!CittaCliente = Me.CittaCliente
            rstDest!ProvinciaCliente = Me.ProvinciaCliente
            rstDest!PaeseCliente = Me.PaeseCliente
            rstDest!CodiceDestino = Me.CodiceDestino
            rstDest!DescrizioneDestino1 = Me.DescrizioneDestino1
            rstDest!DescrizioneDestino2 = Me.DescrizioneDestino2
            rstDest!IndirizzoDestino1 = Me.IndirizzoDestino1
            rstDest!IndirizzoDestino2 = Me.IndirizzoDestino2
            rstDest!CapDestino = Me.CapDestino
            rstDest!CittaDestino = Me.CittaDestino
            rstDest!ProvinciaDestino = Me.ProvinciaDestino
            rstDest!PaeseDestino = Me.PaeseDestino
            rstDest!CARTONE = rstOri!CARTONE
            rstDest!Articolo = rstOri!Article
            rstDest!Colore = rstOri!Colore
            rstDest!Taglia = rstOri!Taglia
            rstDest!Pezzi = rstOri!Pezzi
            rstDest!fakeArtToOrder = rstOri!Article
            rstDest!ReferenzaOrdineCliente = Me.ReferenzaOrdine
            rstDest!RiferimentoOrdineCliente = Me.RiferimentoOrdine
            rstDest.Update
            pezziNelBox = pezziNelBox + 1
            rstOri.MoveNext
            If rstOri.EOF = False Then
                If currentBox <> rstOri!CARTONE Then
                    ' controlla se overload e crea righe fino al massimo
                    If pezziNelBox - 1 > maxArticoli Then
                        overload = True
                        MsgBox "troppi articoli diversi nel cartone " & currentBox
                    End If
                    For i = pezziNelBox To maxArticoli
                        rstDest.AddNew
                        rstDest!numeroBPR = Me.numeroBPR
                        rstDest!CodiceCliente = Me.CodiceCliente
                        rstDest!DescrizioneCliente1 = Me.DescrizioneCliente1
                        rstDest!DescrizioneCliente2 = Me.DescrizioneCliente2
                        rstDest!IndirizzoCliente1 = Me.IndirizzoCliente1
                        rstDest!IndirizzoCliente2 = Me.IndirizzoCliente2
                        rstDest!CapCliente = Me.CapCliente
                        rstDest!CittaCliente = Me.CittaCliente
                        rstDest!ProvinciaCliente = Me.ProvinciaCliente
                        rstDest!PaeseCliente = Me.PaeseCliente
                        rstDest!CodiceDestino = Me.CodiceDestino
                        rstDest!DescrizioneDestino1 = Me.DescrizioneDestino1
                        rstDest!DescrizioneDestino2 = Me.DescrizioneDestino2
                        rstDest!IndirizzoDestino1 = Me.IndirizzoDestino1
                        rstDest!IndirizzoDestino2 = Me.IndirizzoDestino2
                        rstDest!CapDestino = Me.CapDestino
                        rstDest!CittaDestino = Me.CittaDestino
                        rstDest!ProvinciaDestino = Me.ProvinciaDestino
                        rstDest!PaeseDestino = Me.PaeseDestino
                        rstDest!CARTONE = currentBox
                        rstDest!fakeArtToOrder = "ZZZ"
                        rstDest!ReferenzaOrdineCliente = Me.ReferenzaOrdine
                        rstDest!RiferimentoOrdineCliente = Me.RiferimentoOrdine
                
                        rstDest.Update
                    Next i
                    currentBox = rstOri!CARTONE
                    pezziNelBox = 1
                End If
            Else 'ultimo box
                ' controlla se overload e crea righe fino al massimo
                If pezziNelBox > maxArticoli Then overload = True
                For i = pezziNelBox To maxArticoli
                     rstDest.AddNew
                     rstDest!numeroBPR = Me.numeroBPR
                     rstDest!CodiceCliente = Me.CodiceCliente
                     rstDest!DescrizioneCliente1 = Me.DescrizioneCliente1
                     rstDest!DescrizioneCliente2 = Me.DescrizioneCliente2
                     rstDest!IndirizzoCliente1 = Me.IndirizzoCliente1
                     rstDest!IndirizzoCliente2 = Me.IndirizzoCliente2
                     rstDest!CapCliente = Me.CapCliente
                     rstDest!CittaCliente = Me.CittaCliente
                     rstDest!ProvinciaCliente = Me.ProvinciaCliente
                     rstDest!PaeseCliente = Me.PaeseCliente
                     rstDest!CodiceDestino = Me.CodiceDestino
                     rstDest!DescrizioneDestino1 = Me.DescrizioneDestino1
                     rstDest!DescrizioneDestino2 = Me.DescrizioneDestino2
                     rstDest!IndirizzoDestino1 = Me.IndirizzoDestino1
                     rstDest!IndirizzoDestino2 = Me.IndirizzoDestino2
                     rstDest!CapDestino = Me.CapDestino
                     rstDest!CittaDestino = Me.CittaDestino
                     rstDest!ProvinciaDestino = Me.ProvinciaDestino
                     rstDest!PaeseDestino = Me.PaeseDestino
                     rstDest!CARTONE = currentBox
                     rstDest!fakeArtToOrder = "ZZZ"
                     rstDest!ReferenzaOrdineCliente = Me.ReferenzaOrdine
                     rstDest!RiferimentoOrdineCliente = Me.RiferimentoOrdine

                     rstDest.Update
                Next i
            End If
            
        Wend
    End If
    rstOri.Close
    rstDest.Close
    Set rstOri = CurrentDb.OpenRecordset("SovraccolliDaLettureTest")
    If overload = True Then MsgBox "Attenzione: troppi articoli diversi in alcuni colli"
    MsgBox "Colli contati: " & rstOri!cartonicontati & ". Numero Massimo Cartone: " & rstOri!numeromaxcartone & ". Totale pezzi imballati " & rstOri!pezzitotali & "."
    Me.NumeroCartoniContati = rstOri!cartonicontati
    rstOri.Close
    DoCmd.Hourglass False
    
    ' a questo punto genera le righe per sovraccollo mettendo numero massimo pari a nove con segnale di allarme, indicanto in fase di apertura il numero dei colli il numero massimo individuato e i pezzi presenti
    
    DoCmd.OpenReport "ReportOkSovraccolliDaLetture", acViewPreview
End Sub

GO

-- Form_Principale:3911-4065
/* Private Sub TastoGeneraDaLetture_UPC_Click */
Private Sub TastoGeneraDaLetture_UPC_Click()
    MsgBox "Attenzione il report sovraccolli usa sempre il filtro stagione per selezionare eventuali carry over con lo stesso EAN/UPC su diversi articoli. Il numero totale paia potrebbe quindi essere inferiore al numero totale delle letture"
    
    If Me.FiltroStagioneSovraccolli = "" Or IsNull(Me.FiltroStagioneSovraccolli) = True Then
        MsgBox "Inserire filtro stagione"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
    Dim rstDest As DAO.Recordset
    Dim rstOri As DAO.Recordset
    
    Dim i As Integer
    
    Dim maxArticoli As Integer
    maxArticoli = 12
    
    Dim qdf As QueryDef
    Set qdf = CurrentDb.QueryDefs("SovraccolliDaLetture_upc")
    qdf.Parameters("[Forms!principale!filtrostagionesovraccolli]") = Me.FiltroStagioneSovraccolli

    Set rstOri = qdf.OpenRecordset
    'Set rstOri = CurrentDb.OpenRecordset("SovraccolliDaLetture_UPC")
    CurrentDb.Execute ("delete * from TabellaAppoggioSovraccolliDaLetture")
    Set rstDest = CurrentDb.OpenRecordset("TabellaAppoggioSovraccolliDaLetture")
    Dim overload As Boolean
    overload = False
    Dim currentBox As Integer
    currentBox = 0
    Dim pezziNelBox As Integer
    pezziNelBox = 0
    If rstOri.RecordCount > 0 Then
        rstOri.MoveFirst
        currentBox = rstOri!CARTONE
        pezziNelBox = 1
        While rstOri.EOF = False
            rstDest.AddNew
            rstDest!numeroBPR = Me.numeroBPR
            rstDest!CodiceCliente = Me.CodiceCliente
            rstDest!DescrizioneCliente1 = Me.DescrizioneCliente1
            rstDest!DescrizioneCliente2 = Me.DescrizioneCliente2
            rstDest!IndirizzoCliente1 = Me.IndirizzoCliente1
            rstDest!IndirizzoCliente2 = Me.IndirizzoCliente2
            rstDest!CapCliente = Me.CapCliente
            rstDest!CittaCliente = Me.CittaCliente
            rstDest!ProvinciaCliente = Me.ProvinciaCliente
            rstDest!PaeseCliente = Me.PaeseCliente
            rstDest!CodiceDestino = Me.CodiceDestino
            rstDest!DescrizioneDestino1 = Me.DescrizioneDestino1
            rstDest!DescrizioneDestino2 = Me.DescrizioneDestino2
            rstDest!IndirizzoDestino1 = Me.IndirizzoDestino1
            rstDest!IndirizzoDestino2 = Me.IndirizzoDestino2
            rstDest!CapDestino = Me.CapDestino
            rstDest!CittaDestino = Me.CittaDestino
            rstDest!ProvinciaDestino = Me.ProvinciaDestino
            rstDest!PaeseDestino = Me.PaeseDestino
            rstDest!CARTONE = rstOri!CARTONE
            rstDest!Articolo = rstOri!Article
            rstDest!Colore = rstOri!Colore
            rstDest!Taglia = rstOri!Taglia
            rstDest!Pezzi = rstOri!Pezzi
            rstDest!fakeArtToOrder = rstOri!Article
            rstDest!ReferenzaOrdineCliente = Me.ReferenzaOrdine
            rstDest!RiferimentoOrdineCliente = Me.RiferimentoOrdine
            
            rstDest.Update
            pezziNelBox = pezziNelBox + 1
            rstOri.MoveNext
            If rstOri.EOF = False Then
                If currentBox <> rstOri!CARTONE Then
                    ' controlla se overload e crea righe fino al massimo
                    If pezziNelBox - 1 > maxArticoli Then
                        overload = True
                        MsgBox "troppi articoli diversi nel cartone " & currentBox
                    End If
                    For i = pezziNelBox To maxArticoli
                        rstDest.AddNew
                        rstDest!numeroBPR = Me.numeroBPR
                        rstDest!CodiceCliente = Me.CodiceCliente
                        rstDest!DescrizioneCliente1 = Me.DescrizioneCliente1
                        rstDest!DescrizioneCliente2 = Me.DescrizioneCliente2
                        rstDest!IndirizzoCliente1 = Me.IndirizzoCliente1
                        rstDest!IndirizzoCliente2 = Me.IndirizzoCliente2
                        rstDest!CapCliente = Me.CapCliente
                        rstDest!CittaCliente = Me.CittaCliente
                        rstDest!ProvinciaCliente = Me.ProvinciaCliente
                        rstDest!PaeseCliente = Me.PaeseCliente
                        rstDest!CodiceDestino = Me.CodiceDestino
                        rstDest!DescrizioneDestino1 = Me.DescrizioneDestino1
                        rstDest!DescrizioneDestino2 = Me.DescrizioneDestino2
                        rstDest!IndirizzoDestino1 = Me.IndirizzoDestino1
                        rstDest!IndirizzoDestino2 = Me.IndirizzoDestino2
                        rstDest!CapDestino = Me.CapDestino
                        rstDest!CittaDestino = Me.CittaDestino
                        rstDest!ProvinciaDestino = Me.ProvinciaDestino
                        rstDest!PaeseDestino = Me.PaeseDestino
                        rstDest!CARTONE = currentBox
                        rstDest!fakeArtToOrder = "ZZZ"
                        rstDest!ReferenzaOrdineCliente = Me.ReferenzaOrdine
                        rstDest!RiferimentoOrdineCliente = Me.RiferimentoOrdine
                
                        rstDest.Update
                    Next i
                    currentBox = rstOri!CARTONE
                    pezziNelBox = 1
                End If
            Else 'ultimo box
                ' controlla se overload e crea righe fino al massimo
                If pezziNelBox > maxArticoli Then overload = True
                For i = pezziNelBox To maxArticoli
                     rstDest.AddNew
                     rstDest!numeroBPR = Me.numeroBPR
                     rstDest!CodiceCliente = Me.CodiceCliente
                     rstDest!DescrizioneCliente1 = Me.DescrizioneCliente1
                     rstDest!DescrizioneCliente2 = Me.DescrizioneCliente2
                     rstDest!IndirizzoCliente1 = Me.IndirizzoCliente1
                     rstDest!IndirizzoCliente2 = Me.IndirizzoCliente2
                     rstDest!CapCliente = Me.CapCliente
                     rstDest!CittaCliente = Me.CittaCliente
                     rstDest!ProvinciaCliente = Me.ProvinciaCliente
                     rstDest!PaeseCliente = Me.PaeseCliente
                     rstDest!CodiceDestino = Me.CodiceDestino
                     rstDest!DescrizioneDestino1 = Me.DescrizioneDestino1
                     rstDest!DescrizioneDestino2 = Me.DescrizioneDestino2
                     rstDest!IndirizzoDestino1 = Me.IndirizzoDestino1
                     rstDest!IndirizzoDestino2 = Me.IndirizzoDestino2
                     rstDest!CapDestino = Me.CapDestino
                     rstDest!CittaDestino = Me.CittaDestino
                     rstDest!ProvinciaDestino = Me.ProvinciaDestino
                     rstDest!PaeseDestino = Me.PaeseDestino
                     rstDest!CARTONE = currentBox
                     rstDest!fakeArtToOrder = "ZZZ"
                     rstDest!ReferenzaOrdineCliente = Me.ReferenzaOrdine
                     rstDest!RiferimentoOrdineCliente = Me.RiferimentoOrdine

                     rstDest.Update
                Next i
            End If
            
        Wend
    End If
    rstOri.Close
    rstDest.Close
    Set rstOri = CurrentDb.OpenRecordset("SovraccolliDaLettureTest")
    If overload = True Then MsgBox "Attenzione: troppi articoli diversi in alcuni colli"
    MsgBox "Colli contati: " & rstOri!cartonicontati & ". Numero Massimo Cartone: " & rstOri!numeromaxcartone & ". Totale pezzi imballati " & rstOri!pezzitotali & "."
    Me.NumeroCartoniContati = rstOri!cartonicontati
    rstOri.Close
    DoCmd.Hourglass False
    
    ' a questo punto genera le righe per sovraccollo mettendo numero massimo pari a nove con segnale di allarme, indicanto in fase di apertura il numero dei colli il numero massimo individuato e i pezzi presenti
    
    DoCmd.OpenReport "ReportOkSovraccolliDaLetture", acViewPreview

End Sub

GO

-- Form_Principale:4067-4081
/* Private Sub TastoGeneraEtichetteMaterialPubblicitario_Click */
Private Sub TastoGeneraEtichetteMaterialPubblicitario_Click()
    If Me.filtroODAEAN = "" Or IsNull(Me.filtroODAEAN) = True Then
        MsgBox "Inserire Numero ODA"
        Exit Sub
    End If
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "ListaSovraccolliMaterialePubblicitario" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "SovraccolliMaterialePubblicitario", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:4083-4144
/* Private Sub TastoGeneraFileEtichetteEAC_Click */
Private Sub TastoGeneraFileEtichetteEAC_Click()
    If (Me.NumeroSPD = "" Or IsNull(Me.NumeroSPD) = True) Then
        MsgBox "Inserire numero SPD"
        Exit Sub
    End If
    DoCmd.Hourglass True
    
    ' dalla versione 31.3 si tiene il flusso generale (e i nomi) ma non esporta più per stampa unione ma esegue il report autonomamente
    
    ' fase 1 dalla spd selezionata crea n righe per la quantita
    Dim n As Integer
    Dim rstTmp As DAO.Recordset
    Dim rstEti As DAO.Recordset
    Dim strQry As String
    Dim qdf As QueryDef
    If Me.NumeroSPD <> "" Then
        Set qdf = CurrentDb.QueryDefs("eac_stampaunione")
        qdf.Parameters("[Forms!principale!nUMEROsPD]") = Me.NumeroSPD

    End If
    
    Set rstTmp = qdf.OpenRecordset
    CurrentDb.Execute ("delete from [EAC Tabella Per Stampa Unione]")
    Set rstEti = CurrentDb.OpenRecordset("EAC Tabella Per Stampa Unione")
    If rstTmp.EOF = False Then
        rstTmp.MoveFirst
        While rstTmp.EOF = False
            For n = 1 To rstTmp![qty]
                rstEti.AddNew
                rstEti!No_ = rstTmp![Model Item No_]
                rstEti![variable code 01] = rstTmp![variable code 01]
                rstEti![variable code 02] = rstTmp![variable code 02]
                rstEti.Update
            Next n
            rstTmp.MoveNext
        Wend
    End If
    rstTmp.Close
    rstEti.Close
    
    Set rstTmp = CurrentDb.OpenRecordset("EtichettaEacExport_TestMancanti")
    If rstTmp.RecordCount > 0 Then
        ' fase 2a messaggio se ci sono articoli materiali colori nn presenti nel file con le traduzioni e nel caso estrae il file
        MsgBox "Attenzione vi sono informazioni mancanti su alcuni articolo materiali colori. Controllare il file estratto"
    
        Dim exportFileName As String
        exportFileName = "etichette EAC"
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
        
        ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
            'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
            DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "etichettaeacexport", exportFileName, True
        MsgBox "Estrazione Completata"
    Else
        ' fase 2b stampa il record etichette eac
        DoCmd.OpenReport "EtichettaEacExport", acViewPreview
    End If
    DoCmd.Hourglass False
    rstTmp.Close


End Sub

GO

-- Form_Principale:4146-4206
/* Private Sub TastoGeneraFileEtichetteEAC_KID_Click */
Private Sub TastoGeneraFileEtichetteEAC_KID_Click()
    If (Me.NumeroSPD = "" Or IsNull(Me.NumeroSPD) = True) Then
        MsgBox "Inserire numero SPD"
        Exit Sub
    End If
    DoCmd.Hourglass True
    
    ' dalla versione 31.3 si tiene il flusso generale (e i nomi) ma non esporta più per stampa unione ma esegue il report autonomamente
    
    ' fase 1 dalla spd selezionata crea n righe per la quantita
    Dim n As Integer
    Dim rstTmp As DAO.Recordset
    Dim rstEti As DAO.Recordset
    Dim strQry As String
    Dim qdf As QueryDef
    If Me.NumeroSPD <> "" Then
        Set qdf = CurrentDb.QueryDefs("eac_stampaunione")
        qdf.Parameters("[Forms!principale!nUMEROsPD]") = Me.NumeroSPD

    End If
    
    Set rstTmp = qdf.OpenRecordset
    CurrentDb.Execute ("delete from [EAC Tabella Per Stampa Unione]")
    Set rstEti = CurrentDb.OpenRecordset("EAC Tabella Per Stampa Unione")
    If rstTmp.EOF = False Then
        rstTmp.MoveFirst
        While rstTmp.EOF = False
            For n = 1 To rstTmp![qty]
                rstEti.AddNew
                rstEti!No_ = rstTmp![Model Item No_]
                rstEti![variable code 01] = rstTmp![variable code 01]
                rstEti![variable code 02] = rstTmp![variable code 02]
                rstEti.Update
            Next n
            rstTmp.MoveNext
        Wend
    End If
    rstTmp.Close
    rstEti.Close
    
    Set rstTmp = CurrentDb.OpenRecordset("EtichettaEacExport_TestMancanti")
    If rstTmp.RecordCount > 0 Then
        ' fase 2a messaggio se ci sono articoli materiali colori nn presenti nel file con le traduzioni e nel caso estrae il file
        MsgBox "Attenzione vi sono informazioni mancanti su alcuni articolo materiali colori. Controllare il file estratto"
    
        Dim exportFileName As String
        exportFileName = "etichette EAC"
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
        
        ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
            'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
            DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "etichettaeacexport", exportFileName, True
        MsgBox "Estrazione Completata"
    Else
        ' fase 2b stampa il record etichette eac
        DoCmd.OpenReport "EtichettaEacExport_KID", acViewPreview
    End If
    DoCmd.Hourglass False
    rstTmp.Close

End Sub

GO

-- Form_Principale:4208-4306
/* Private Sub TastoGeneraLinksImmagini_Click */
Private Sub TastoGeneraLinksImmagini_Click()
    ' Test campi compilati
    If IsNull(Me.ControlloPediceFileDestinazione) Or IsNull(Me.ControlloPediceFileOrigine) Or IsNull(Me.ControlloTipoDestinazione) Or IsNull(Me.ControlloTipoOrigine) Or IsNull(Me.FiltroMarchioPerGeneraLinks) Or IsNull(Me.FiltroStagionePerGeneraLinks) Then
        MsgBox "Inserire tutti i parametri"
        Exit Sub
    End If
    ' MsgBox "ATTENZIONE: FUNZIONALITà ANCORA IN FASE DI TEST; RICORDARE DI ESEGUIRE UNA VOLTA SOLA"
    ' Step 1 Determina le righe di appoggio origine
    DoCmd.Hourglass True
    Dim rstOrig As DAO.Recordset
    Dim rstOrig2 As DAO.Recordset
    Dim rstOrig3 As DAO.Recordset
    ' Verifica se gà esistente
    Dim rstTest As DAO.Recordset
    Set rstOrig = CurrentDb.OpenRecordset("select * from Percreazionelinks where [Document Type]=" & Left$([Forms]![principale]![ControlloTipoOrigine], 1) & " AND [Trademark Code]='" & [Forms]![principale]![FiltroMarchioPerGeneraLinks] & "' AND  [Season Code]='" & [Forms]![principale]![FiltroStagionePerGeneraLinks] & "'")
    ' Step 2 Crea una tabella temporanea per l'appoggio (cambia nome file e tipo)
    CurrentDb.Execute ("Delete from TMPTable")
    Dim rstDest As DAO.Recordset
    Set rstDest = CurrentDb.OpenRecordset("TMPTable")
    If rstOrig.RecordCount > 0 Then
        rstOrig.MoveFirst
        While rstOrig.EOF = False
            rstDest.AddNew
            Set rstTest = CurrentDb.OpenRecordset("select * from Percreazionelinks where [Document Type]=" & Left$([Forms]![principale]![ControlloTipoDestinazione], 1) & " AND [Source No_]='" & rstOrig![source no_] & "' AND  [Constant Variable Code] ='" & rstOrig![constant variable code] & "'")
            If rstTest.RecordCount = 0 Then
                ' link non esistente procedere
                rstDest![Source Type] = rstOrig![Source Type]
                rstDest![source no_] = rstOrig![source no_]
                rstDest![Source Line No_] = rstOrig![Source Line No_]
                Set rstOrig2 = CurrentDb.OpenRecordset("select max([Line No_]) as maxLine from [External Linked Documents] where [Source No_]='" & rstOrig![source no_] & "' group by [Source No_]")
                Set rstOrig3 = CurrentDb.OpenRecordset("select max([Line No_]) as maxLine from [TMPTable] where [Source No_]='" & rstOrig![source no_] & "' group by [Source No_]")
                If rstOrig3.RecordCount > 0 Then
                    If rstOrig2!maxline > rstOrig3!maxline Then
                        rstDest![Line No_] = rstOrig2!maxline + 5
                    Else
                        rstDest![Line No_] = rstOrig3!maxline + 5
                    End If
                Else
                    rstDest![Line No_] = rstOrig2!maxline + 5
                End If
                rstDest![Document Type] = Left$(Forms!principale!ControlloTipoDestinazione, 1)
                rstDest![Description] = rstOrig![Description]
                'test denominazione file
                Dim L As Integer, l1 As Integer
                L = Len(rstOrig![Linked Document])
                l1 = Len(Forms!principale!ControlloPediceFileOrigine)
                ' lunghezza errata
                If L < l1 And L > 0 Then
                    MsgBox ("Errore file origine: " & rstOrig![source no_] & " " & rstOrig![constant variable code] & rstOrig![Linked Document])
                    MsgBox ("Procedura abortita: sistemare i dati ed eseguire nuovamente")
                    DoCmd.Hourglass False
                    Exit Sub
                ' file non presente
                ElseIf L = 0 Then
                    rstDest![Linked Document] = rstOrig![Linked Document]
                Else
                    If Me.FlagCreaPerKimo = False Then
                        rstDest![Linked Document] = Left$(rstOrig![Linked Document], Len(rstOrig![Linked Document]) - Len(Forms!principale!ControlloPediceFileOrigine)) & Forms!principale!ControlloPediceFileDestinazione
                    Else
                        Dim pos As Integer
                        Dim filenamewithoutpath As String
                        filenamewithoutpath = rstOrig![Linked Document]
                        pos = InStr(filenamewithoutpath, "\")
                        While pos > 0
                            filenamewithoutpath = Right$(filenamewithoutpath, Len(filenamewithoutpath) - pos)
                            pos = InStr(filenamewithoutpath, "\")
                        Wend
                        'rstDest![Linked Document] = Me.ControlloPercorsoKimo & FiltroStagionePerGeneraLinks & "\" & FiltroMarchioPerGeneraLinks.Value & "\" & Left$(filenamewithoutpath, Len(filenamewithoutpath) - Len(Forms!PRINCIPALE!ControlloPediceFileOrigine)) & Forms!PRINCIPALE!ControlloPediceFileDestinazione
                        ' il percorso è solo relativo a kimo
                        rstDest![Linked Document] = FiltroStagionePerGeneraLinks & "\" & FiltroMarchioPerGeneraLinks.Value & "\" & Left$(filenamewithoutpath, Len(filenamewithoutpath) - Len(Forms!principale!ControlloPediceFileOrigine)) & Forms!principale!ControlloPediceFileDestinazione
                    End If
                End If
                
                rstDest![Constant Assortment Var_Grp_] = rstOrig![Constant Assortment Var_Grp_]
                rstDest![constant variable code] = rstOrig![constant variable code]
                ' AAA: per versione KIMO
                If Me.FlagUsaMetodoVecchio = False Then
                    rstDest!priority = 0
                    rstDest![file not found] = 0
                    rstDest![picture caption] = "_"
                    rstDest![Description] = "_"
                End If
                rstDest.Update
            Else
                'MsgBox "Link già esistente"
            End If
            rstOrig.MoveNext
        Wend
    End If
    ' Step 3 Append sulla tabella
    If Me.FlagUsaMetodoVecchio = False Then
        CurrentDb.Execute ("PerCreazioneLinks-Accoda")
    Else
        CurrentDb.Execute ("PerCreazioneLinks-AccodaMetodoVecchio")
    End If
    
    DoCmd.Hourglass False
    MsgBox "Generazione Completata"
End Sub

GO

-- Form_Principale:4308-4377
/* Private Sub TastoGeneraLinksImmaginiPrimarie_Click */
Private Sub TastoGeneraLinksImmaginiPrimarie_Click()
    ' Test campi compilati
    If IsNull(Me.FiltroMarchioPerGeneraLinks) Or IsNull(Me.FiltroStagionePerGeneraLinks) Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    ' MsgBox "ATTENZIONE: FUNZIONALITà ANCORA IN FASE DI TEST; RICORDARE DI ESEGUIRE UNA VOLTA SOLA"
    ' Step 1 Determina le righe di appoggio origine
    DoCmd.Hourglass True
    Dim rstOrig As DAO.Recordset
    Dim rstOrig2 As DAO.Recordset
    Dim rstOrig3 As DAO.Recordset
    ' Verifica se gà esistente
    Dim rstTest As DAO.Recordset
    'Set rstOrig = CurrentDb.OpenRecordset("select * from creazioneDocumentiImmaginiMediumBook where [Document Type]=" & Left$([Forms]![principale]![ControlloTipoOrigine], 1) & " AND [Trademark Code]='" & [Forms]![principale]![FiltroMarchioPerGeneraLinks] & "' AND  [Season Code]='" & [Forms]![principale]![FiltroStagionePerGeneraLinks] & "'")
    Dim qdf As QueryDef
    Set qdf = CurrentDb.QueryDefs("creazioneDocumentiImmaginiMediumBook")
    qdf.Parameters("Configurator relation Filter") = 3
    qdf.Parameters("forms!principale!filtromarchiopergeneralinks") = Me.FiltroMarchioPerGeneraLinks
    qdf.Parameters("forms!principale!filtrostagionepergeneralinks") = Me.FiltroStagionePerGeneraLinks
    
    'Set rstOrig = CurrentDb.OpenRecordset("select * from creazioneDocumentiImmaginiMediumBook where [configurator relation]=3 and [Trademark Code]='" & [Forms]![principale]![FiltroMarchioPerGeneraLinks] & "' AND  [Season Code]='" & [Forms]![principale]![FiltroStagionePerGeneraLinks] & "'")
    
    Set rstOrig = qdf.OpenRecordset
    ' Step 2 Crea una tabella temporanea per l'appoggio (cambia nome file e tipo)
    CurrentDb.Execute ("Delete from TMPTable")
    Dim rstDest As DAO.Recordset
    Set rstDest = CurrentDb.OpenRecordset("TMPTable")
    If rstOrig.RecordCount > 0 Then
        rstOrig.MoveFirst
        While rstOrig.EOF = False
            Set rstTest = CurrentDb.OpenRecordset("select * from Percreazionelinks where [Document Type]=2" & " AND [Source No_]='" & rstOrig![source no_] & "' AND  [Constant Variable Code] ='" & rstOrig![constant variable code] & "'")
            If rstTest.RecordCount = 0 Then
                rstDest.AddNew
                ' link non esistente procedere
                rstDest![Source Type] = rstOrig![Source Type]
                rstDest![source no_] = rstOrig![source no_]
                rstDest![Source Line No_] = rstOrig![Source Line No_]
                Set rstOrig2 = CurrentDb.OpenRecordset("select max([Line No_]) as maxLine from [External Linked Documents] where [Source No_]='" & rstOrig![source no_] & "' group by [Source No_]")
                Set rstOrig3 = CurrentDb.OpenRecordset("select max([Line No_]) as maxLine from [TMPTable] where [Source No_]='" & rstOrig![source no_] & "' group by [Source No_]")
                Dim maxlineOrig As Long, maxlineTemp As Long
                maxlineOrig = 0
                maxlineTemp = 0
                If rstOrig3.RecordCount > 0 Then maxlineTemp = rstOrig3!maxline
                If rstOrig2.RecordCount > 0 Then maxlineOrig = rstOrig2!maxline
                If maxlineOrig > maxlineTemp Then
                    rstDest![Line No_] = maxlineOrig + 5
                Else
                    rstDest![Line No_] = maxlineTemp + 5
                End If
                rstDest![Document Type] = rstOrig![Document Type]
                rstDest![Description] = rstOrig![Description]
                rstDest![Linked Document] = rstOrig![Linked Document]
                rstDest![Constant Assortment Var_Grp_] = rstOrig![Constant Assortment Var_Grp_]
                rstDest![constant variable code] = rstOrig![constant variable code]
                rstDest![picture caption] = rstOrig![picture caption]
                rstDest.Update
            Else
                'MsgBox "Link già esistente"
            End If
            rstOrig.MoveNext
        Wend
    End If
    ' Step 3 Append sulla tabella
    CurrentDb.Execute ("PerCreazioneLinks-Accoda")
    
    DoCmd.Hourglass False
    MsgBox "Generazione Completata"

End Sub

GO

-- Form_Principale:4379-4386
/* Private Sub TastoGeneraSovraccolliBarcode_Click */
Private Sub TastoGeneraSovraccolliBarcode_Click()
    
    MsgBox "Attenzione. Esportare da Nav la lista [Sovraccolli Excel] e depositare con nome [sovraccollibarcode.xls] nella posizione X:\ListaPerSovraccolliDaLetture"
    MsgBox "Attenzione. Impaginazione corretta solo con gruppi taglie da 7"
    MsgBox "Attenzione. Cablata visualizzazione taglia europea convertita da gruppo taglie americano"
    DoCmd.OpenReport "ReportOkSovraccolli_Barcode", acViewPreview
    
End Sub

GO

-- Form_Principale:4388-4448
/* Private Sub TastoGeneraSovraccolliTjx_Click */
Private Sub TastoGeneraSovraccolliTjx_Click()
    If Me.NumeroODV = "" Or IsNull(Me.NumeroODV) Then
        MsgBox "Selezionare un numero ordine"
        Exit Sub
    End If
    Dim rstDest As DAO.Recordset
    Dim rstOri As DAO.Recordset
    Dim rstOri1 As DAO.Recordset ' le righe nascoste
    CurrentDb.Execute ("delete * from tabellaappoggiotjx")
    Set rstDest = CurrentDb.OpenRecordset("TabellaAppoggiotjx")
    ' selezione tutte le righe di tipo assortimento presenti nell'ordine di vendita
    Set rstOri = CurrentDb.OpenRecordset("select * from SovraccolliTjx where [OrdineNr]='" & Me.NumeroODV & "' and [delete reason]='' and ([type]=20)")
    ' NB TENTATIVO 2016 02 25 per estrazione anche articoli modelli
    'Set rstOri = CurrentDb.OpenRecordset("select * from SovraccolliTjx where [OrdineNr]='" & Me.NumeroODV & "' and [delete reason]='' and ([type]=20 or type=19)")
    
    If rstOri.RecordCount > 0 Then
        Dim contaassortimenti As Integer
        contaassortimenti = 0
        ' per caso di numero assortimenti maggiore di uno in riga
        Dim i As Integer
        rstOri.MoveFirst
        While rstOri.EOF = False
            For i = 1 To rstOri!quantita
                ' ricerca righe nascoste
                contaassortimenti = contaassortimenti + 1
                rstDest.AddNew
                rstDest!idcollo = contaassortimenti
                rstDest!ReferenzaOrdineCliente = rstOri!ReferenzaOrdineCliente
                
                rstDest!RiferimentoOrdineCliente = rstOri!RiferimentoOrdineCliente
                rstDest!Articolo = rstOri!Articolo
                rstDest!Descrizione2 = rstOri!Descrizione2
                rstDest!Colore = rstOri!Colore
                rstDest!descrizionecolore = rstOri!descrizionecolore
                rstDest!paiacartone = rstOri!paia / rstOri!quantita
                rstDest!assortimento = rstOri!assortimento
                ' dati taglie
                Set rstOri1 = CurrentDb.OpenRecordset("select * from SovraccolliTjxDettaglioTaglie where ordinenr = '" & rstOri!ordinenr & "' and lineaoriginalenr = " & rstOri!lineanr)
                If rstOri1.RecordCount > 0 Then
                    While rstOri1.EOF = False
                        Dim j
                        For j = 0 To rstDest.Fields.count - 1
                            Debug.Print rstDest.Fields(j).Name
                            Debug.Print rstOri1!Taglia
                            If rstDest.Fields(j).Name = rstOri1!Taglia Then rstDest.Fields(j).Value = rstOri1!quantitataglia / rstOri!quantita
                        Next j
                        rstOri1.MoveNext
                    Wend
                End If
                rstDest.Update
           
            Next i
            rstOri.MoveNext
        Wend
    End If
    rstDest.Close
    rstOri.Close
    DoCmd.OpenReport "reporttjx", acViewPreview


End Sub

GO

-- Form_Principale:4450-4603
/* Private Sub TastoGeneraSovraccolliTjxEAN_Click */
Private Sub TastoGeneraSovraccolliTjxEAN_Click()
    MsgBox "Attenzione il report sovraccolli usa sempre il filtro stagione per selezionare eventuali carry over con lo stesso EAN/UPC su diversi articoli. Il numero totale paia potrebbe quindi essere inferiore al numero totale delle letture"
    If Me.FiltroStagioneSovraccolli = "" Or IsNull(Me.FiltroStagioneSovraccolli) = True Then
        MsgBox "Inserire filtro stagione"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
    Dim rstDest As DAO.Recordset
    Dim rstOri As DAO.Recordset
    
    Dim i As Integer
    
    Dim maxArticoli As Integer
    maxArticoli = 12
    
    Dim qdf As QueryDef
    Set qdf = CurrentDb.QueryDefs("SovraccolliDaLettureTJX")
    qdf.Parameters("[Forms!principale!filtrostagionesovraccolli]") = Me.FiltroStagioneSovraccolli

    Set rstOri = qdf.OpenRecordset
    'Set rstOri = CurrentDb.OpenRecordset("SovraccolliDaLetture")
    CurrentDb.Execute ("delete * from TabellaAppoggioSovraccolliDaLetture")
    Set rstDest = CurrentDb.OpenRecordset("TabellaAppoggioSovraccolliDaLetture")
    Dim overload As Boolean
    overload = False
    Dim currentBox As Integer
    currentBox = 0
    Dim pezziNelBox As Integer
    pezziNelBox = 0
    If rstOri.RecordCount > 0 Then
        rstOri.MoveFirst
        currentBox = rstOri!CARTONE
        pezziNelBox = 1
        While rstOri.EOF = False
            rstDest.AddNew
            rstDest!numeroBPR = Me.numeroBPR
            rstDest!CodiceCliente = Me.CodiceCliente
            rstDest!DescrizioneCliente1 = Me.DescrizioneCliente1
            rstDest!DescrizioneCliente2 = Me.DescrizioneCliente2
            rstDest!IndirizzoCliente1 = Me.IndirizzoCliente1
            rstDest!IndirizzoCliente2 = Me.IndirizzoCliente2
            rstDest!CapCliente = Me.CapCliente
            rstDest!CittaCliente = Me.CittaCliente
            rstDest!ProvinciaCliente = Me.ProvinciaCliente
            rstDest!PaeseCliente = Me.PaeseCliente
            rstDest!CodiceDestino = Me.CodiceDestino
            rstDest!DescrizioneDestino1 = Me.DescrizioneDestino1
            rstDest!DescrizioneDestino2 = Me.DescrizioneDestino2
            rstDest!IndirizzoDestino1 = Me.IndirizzoDestino1
            rstDest!IndirizzoDestino2 = Me.IndirizzoDestino2
            rstDest!CapDestino = Me.CapDestino
            rstDest!CittaDestino = Me.CittaDestino
            rstDest!ProvinciaDestino = Me.ProvinciaDestino
            rstDest!PaeseDestino = Me.PaeseDestino
            rstDest!CARTONE = rstOri!CARTONE
            rstDest!Articolo = rstOri!Article
            rstDest!Colore = rstOri!Colore
            rstDest!Taglia = ""
            rstDest!Pezzi = rstOri!Pezzi
            rstDest!fakeArtToOrder = rstOri!Article
            rstDest!ReferenzaOrdineCliente = Me.ReferenzaOrdine
            rstDest!RiferimentoOrdineCliente = Me.RiferimentoOrdine
            rstDest.Update
            pezziNelBox = pezziNelBox + 1
            rstOri.MoveNext
            If rstOri.EOF = False Then
                If currentBox <> rstOri!CARTONE Then
                    ' controlla se overload e crea righe fino al massimo
                    If pezziNelBox - 1 > maxArticoli Then
                        overload = True
                        MsgBox "troppi articoli diversi nel cartone " & currentBox
                    End If
                    For i = pezziNelBox To maxArticoli
                        rstDest.AddNew
                        rstDest!numeroBPR = Me.numeroBPR
                        rstDest!CodiceCliente = Me.CodiceCliente
                        rstDest!DescrizioneCliente1 = Me.DescrizioneCliente1
                        rstDest!DescrizioneCliente2 = Me.DescrizioneCliente2
                        rstDest!IndirizzoCliente1 = Me.IndirizzoCliente1
                        rstDest!IndirizzoCliente2 = Me.IndirizzoCliente2
                        rstDest!CapCliente = Me.CapCliente
                        rstDest!CittaCliente = Me.CittaCliente
                        rstDest!ProvinciaCliente = Me.ProvinciaCliente
                        rstDest!PaeseCliente = Me.PaeseCliente
                        rstDest!CodiceDestino = Me.CodiceDestino
                        rstDest!DescrizioneDestino1 = Me.DescrizioneDestino1
                        rstDest!DescrizioneDestino2 = Me.DescrizioneDestino2
                        rstDest!IndirizzoDestino1 = Me.IndirizzoDestino1
                        rstDest!IndirizzoDestino2 = Me.IndirizzoDestino2
                        rstDest!CapDestino = Me.CapDestino
                        rstDest!CittaDestino = Me.CittaDestino
                        rstDest!ProvinciaDestino = Me.ProvinciaDestino
                        rstDest!PaeseDestino = Me.PaeseDestino
                        rstDest!CARTONE = currentBox
                        rstDest!fakeArtToOrder = "ZZZ"
                        rstDest!ReferenzaOrdineCliente = Me.ReferenzaOrdine
                        rstDest!RiferimentoOrdineCliente = Me.RiferimentoOrdine
                
                        rstDest.Update
                    Next i
                    currentBox = rstOri!CARTONE
                    pezziNelBox = 1
                End If
            Else 'ultimo box
                ' controlla se overload e crea righe fino al massimo
                If pezziNelBox > maxArticoli Then overload = True
                For i = pezziNelBox To maxArticoli
                     rstDest.AddNew
                     rstDest!numeroBPR = Me.numeroBPR
                     rstDest!CodiceCliente = Me.CodiceCliente
                     rstDest!DescrizioneCliente1 = Me.DescrizioneCliente1
                     rstDest!DescrizioneCliente2 = Me.DescrizioneCliente2
                     rstDest!IndirizzoCliente1 = Me.IndirizzoCliente1
                     rstDest!IndirizzoCliente2 = Me.IndirizzoCliente2
                     rstDest!CapCliente = Me.CapCliente
                     rstDest!CittaCliente = Me.CittaCliente
                     rstDest!ProvinciaCliente = Me.ProvinciaCliente
                     rstDest!PaeseCliente = Me.PaeseCliente
                     rstDest!CodiceDestino = Me.CodiceDestino
                     rstDest!DescrizioneDestino1 = Me.DescrizioneDestino1
                     rstDest!DescrizioneDestino2 = Me.DescrizioneDestino2
                     rstDest!IndirizzoDestino1 = Me.IndirizzoDestino1
                     rstDest!IndirizzoDestino2 = Me.IndirizzoDestino2
                     rstDest!CapDestino = Me.CapDestino
                     rstDest!CittaDestino = Me.CittaDestino
                     rstDest!ProvinciaDestino = Me.ProvinciaDestino
                     rstDest!PaeseDestino = Me.PaeseDestino
                     rstDest!CARTONE = currentBox
                     rstDest!fakeArtToOrder = "ZZZ"
                     rstDest!ReferenzaOrdineCliente = Me.ReferenzaOrdine
                     rstDest!RiferimentoOrdineCliente = Me.RiferimentoOrdine

                     rstDest.Update
                Next i
            End If
            
        Wend
    End If
    rstOri.Close
    rstDest.Close
    Set rstOri = CurrentDb.OpenRecordset("SovraccolliDaLettureTest")
    If overload = True Then MsgBox "Attenzione: troppi articoli diversi in alcuni colli"
    Me.NumeroSovraccolli = rstOri!cartonicontati
    MsgBox "Colli contati: " & rstOri!cartonicontati & ". Numero Massimo Cartone: " & rstOri!numeromaxcartone & ". Totale pezzi imballati " & rstOri!pezzitotali & "."
    Me.NumeroCartoniContati = rstOri!cartonicontati
    rstOri.Close
    DoCmd.Hourglass False
    
    ' a questo punto genera le righe per sovraccollo mettendo numero massimo pari a nove con segnale di allarme, indicanto in fase di apertura il numero dei colli il numero massimo individuato e i pezzi presenti
    
    DoCmd.OpenReport "ReportOkSovraccolliDaLetture_TJX", acViewPreview

End Sub

GO

-- Form_Principale:4605-4623
/* Private Sub TastoGeneraSovraccolliTjxManuali_Click */
Private Sub TastoGeneraSovraccolliTjxManuali_Click()
    If Me.NumeroSovraccolli < 0 Or IsNull(Me.NumeroSovraccolli) Then
        MsgBox "inserire il numero sovraccolli da generare"
        Exit Sub
    End If
    Dim rstDest As DAO.Recordset
    CurrentDb.Execute ("delete * from tabellaappoggiotjxmanuali")
    Set rstDest = CurrentDb.OpenRecordset("TabellaAppoggioTJXManuali")
    Dim i As Integer
    For i = 1 To Me.NumeroSovraccolli
        rstDest.AddNew
        rstDest!ReferenzaOrdineCliente = Me.ReferenzaOrdine
        rstDest!RiferimentoOrdineCliente = Me.RiferimentoOrdine
        rstDest.Update
    Next i
    rstDest.Close
    DoCmd.OpenReport "ReportTJXManuali", acViewPreview

End Sub

GO

-- Form_Principale:4625-4632
/* Private Sub TastoGestioneMarchi_Click */
Private Sub TastoGestioneMarchi_Click()
    If livelloUtente >= 1 Then
        DoCmd.OpenTable "DatiCommercialiMarchi"
    Else
        MsgBox "Privilegio non sufficiente"
    End If

End Sub

GO

-- Form_Principale:4634-4641
/* Private Sub TastoGestioneSchedeClienti_Click */
Private Sub TastoGestioneSchedeClienti_Click()
    If livelloUtente >= 1 Then
        DoCmd.OpenForm "DatiCommercialiClienti"
    Else
        MsgBox "Privilegio non sufficiente"
    End If
    
End Sub

GO

-- Form_Principale:4643-4650
/* Private Sub TastoGestioneUtenti_Click */
Private Sub TastoGestioneUtenti_Click()
    If livelloUtente >= 3 Then
        DoCmd.OpenForm "Utenti"
    Else
        MsgBox "Privilegio non sufficiente"
    End If

End Sub

GO

-- Form_Principale:4652-4655
/* Private Sub TastoGestisciRigheBudgetProiezioni_Click */
Private Sub TastoGestisciRigheBudgetProiezioni_Click()
    DoCmd.OpenTable "VendutoComprato_FattoriDiPropiezione", acViewNormal, acEdit
    
End Sub

GO

-- Form_Principale:4657-4663
/* Private Sub TastoGiacenzaAssortimentiLiberi_Click */
Private Sub TastoGiacenzaAssortimentiLiberi_Click()
    MsgBox "Funzionalità in fase di test (e.g. manca la ubicazione); verificare correttezza dati per portare a regime"
    'Exit Sub
    
    DoCmd.OpenQuery "giac-04-giacenzaAssortimentiLibera", acViewPivotChart, acReadOnly

End Sub

GO

-- Form_Principale:4665-4678
/* Private Sub TastoGiacenzaCollocazioni_Click */
Private Sub TastoGiacenzaCollocazioni_Click()

    Dim exportFileName As String
    exportFileName = nomeAzienda & "-GiacenzaCollocazioni-(" & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "gIACENZA Collocazioni", exportFileName, True

    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:4680-4700
/* Private Sub TastoGiacenzaLiberaTagliaVeloce_Click */
Private Sub TastoGiacenzaLiberaTagliaVeloce_Click()
    MsgBox "Attenzione: le prenotazioni vanno cancellate"
    If Me.FiltroMarchioSourcing = "" Or IsNull(Me.FiltroMarchioSourcing) = True Or Me.FiltroStagioneSourcing = "" Or IsNull(Me.FiltroStagioneSourcing) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    

    Dim exportFileName As String
    exportFileName = nomeAzienda & "-GiacenzaLiberaTagliaVeloce-(" & Me.FiltroStagioneSourcing & "_" & Me.FiltroMarchioSourcing & ")-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "GiacenzaLiberaVeloce", exportFileName, True

    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

    DoCmd.Hourglass False


End Sub

GO

-- Form_Principale:4702-4721
/* Private Sub TastoGiacenzaNegativaAssortimenti_Click */
Private Sub TastoGiacenzaNegativaAssortimenti_Click()
    If DataFinale.Value = "" Or IsNull(DataFinale) = True Then
            MsgBox "Inserire data finale"
            Exit Sub
    End If
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-GiacenzaNegativaAssortimento-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "000_check magazzino fine anno ad assortimento_1_trova problemi", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"


End Sub

GO

-- Form_Principale:4723-4736
/* Private Sub TastoGIacenzaPerControlloLogimoda_Click */
Private Sub TastoGIacenzaPerControlloLogimoda_Click()
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-GiacenzaAssortimentoControlloLogimoda-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "GiacenzaAssortimenti", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:4738-4752
/* Private Sub tastoGrigliaAgenti_Click */
Private Sub tastoGrigliaAgenti_Click()
    If Me.CreditoFiltroStagione2 = "" Or IsNull(Me.CreditoFiltroStagione2) = True Or Me.filtroAgentePerGrigliaAgenti = "" Or IsNull(Me.filtroAgentePerGrigliaAgenti) = True Then
        MsgBox "Inserire la stagione da analizzare e l'agente da estrarre"
        Exit Sub
    End If
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-GrigliaAgenti-" & Me.nomeagentenascosto & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "CreditoGrigliaAgenti", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:4754-4759
/* Private Sub TastoImportaEAN_Click */
Private Sub TastoImportaEAN_Click()
    DoCmd.Hourglass True
    CurrentDb.Execute "AggiornaDatiEan"
    MsgBox "Import Completato. Eseguire Controllo"
    DoCmd.Hourglass False
End Sub

GO

-- Form_Principale:4761-4767
/* Private Sub TastoImportaMasterData_Click */
Private Sub TastoImportaMasterData_Click()
    DoCmd.Hourglass True
    CurrentDb.Execute "AggiornamentoDatiPesiNomenclaturaCombDimensioni-ArticoloModello"
    CurrentDb.Execute "AggiornamentoDatiPesiNomenclaturaCombDimensioni-Item"
    MsgBox "Import Completato. Eseguire Controllo"
    DoCmd.Hourglass False
End Sub

GO

-- Form_Principale:4769-4786
/* Private Sub TastoImportaPesi_Click */
Private Sub TastoImportaPesi_Click()
    If Me.FiltroStagionePesiDiDefault.Value = "" Or IsNull(Me.FiltroStagionePesiDiDefault) = True Or Me.FiltroMarchioPesiDiDefault.Value = "" Or IsNull(Me.FiltroMarchioPesiDiDefault) = True Then
        MsgBox "Inserire il filtro stagione e marchio"
        Exit Sub
    End If
    DoCmd.Hourglass True
    
    Dim qdf As QueryDef
    Set qdf = CurrentDb.QueryDefs("AggiornamentoDatiPesi")
    qdf.Parameters("[stagionedifiltro]") = Me.FiltroStagionePesiDiDefault
    qdf.Parameters("marchiodifiltro]") = Me.FiltroMarchioPesiDiDefault
    qdf.Execute
    

    MsgBox "Import Completato. Eseguire Controllo"
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:4788-4794
/* Private Sub TastoImportaUPC_Click */
Private Sub TastoImportaUPC_Click()
    DoCmd.Hourglass True
    CurrentDb.Execute "AggiornaDatiUPC"
    MsgBox "Import Completato. Eseguire Controllo"
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:4796-4828
/* Private Sub TastoInventario_Click */
Private Sub TastoInventario_Click()
    
    If DataFinale.Value = "" Or IsNull(DataFinale) = True Then
            MsgBox "Inserire data finale"
            Exit Sub
    End If
    Dim RES As Integer
    RES = MsgBox("Attenzione deve essere eseguita da un utente per volta. Procedere?", vbYesNo)
    If RES <> 6 Then Exit Sub
    
    DoCmd.Hourglass True
    
    ' per accelerare sostanzialmente il calcolo si creano dati in una tabella di appoggio, svuotata preventivamente
    CurrentDb.Execute "delete from ValutazioneMagazzinoTabella"
    
    Dim qdf As QueryDef
    Set qdf = CurrentDb.QueryDefs("valutazionemagazzino_costi_creadati")
    qdf.Parameters("[forms]![principale]![datafinale]") = Me.DataFinale
    qdf.Execute
    'CurrentDb.Execute "ValutazioneMagazzino_Costi_CreaDati"
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-Inventario-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "inventarioAllaData", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"


End Sub

GO

-- Form_Principale:4830-4840
/* Private Sub TastoListaAppuntamenti_Click */
Private Sub TastoListaAppuntamenti_Click()
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-ListaAppuntamenti-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ListaAppuntamenti", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:4842-4856
/* Private Sub tastoListaClientiBloccati_Click */
Private Sub tastoListaClientiBloccati_Click()
    If Me.CreditoFiltroStagione2 = "" Or IsNull(Me.CreditoFiltroStagione2) = True Then
        MsgBox "Inserire la stagione da analizzare"
        Exit Sub
    End If
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-CreditoClientiBloccati-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "CreditoListaBloccati", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:4858-4868
/* Private Sub TastoListaClientiGDPR_Click */
Private Sub TastoListaClientiGDPR_Click()
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-Lista Clienti GDPR Privacy-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "Lista Clienti GDPR Privacy", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:4870-4881
/* Private Sub TastoListinoKidAcquisto_Click */
Private Sub TastoListinoKidAcquisto_Click()
    ' va in errore
    'DoCmd.Hourglass True
    'Dim exportFileName As String
    'exportFileName = nomeAzienda & "-ListinoKidAcquisto-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    'exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "20061205-PrezziKidPerAnna-ListinoAcquisto", exportFileName, True
    'DoCmd.Hourglass False
    'MsgBox "Estrazione Completata"
    DoCmd.OpenQuery "20061205-PrezziKidPerAnna-ListinoAcquisto", acViewNormal, acReadOnly
End Sub

GO

-- Form_Principale:4883-4893
/* Private Sub TastoListinoKidVendita_Click */
Private Sub TastoListinoKidVendita_Click()
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-ListinoKidVendita-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "20061205-PrezziKidPerAnna-Final", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:4895-4913
/* Private Sub tastoMasterDataArticoli_Click */
Private Sub tastoMasterDataArticoli_Click()
    
    If IsNull(Me.FiltroStagioneEAN) Or Me.FiltroStagioneEAN = "" Then
        MsgBox "Inserire filtro stagione"
        DoCmd.Hourglass False
        Exit Sub
    End If
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-MasterDataArticoli-(" & Me.FiltroStagioneEAN & ")-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    'exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ItemMasterData", exportFileName, True
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ItemMasterData", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"
    
End Sub

GO

-- Form_Principale:4915-4933
/* Private Sub tastoMasterDataArticoliNoListini_Click */
Private Sub tastoMasterDataArticoliNoListini_Click()
    
    If IsNull(Me.FiltroStagioneEAN) Or Me.FiltroStagioneEAN = "" Then
        MsgBox "Inserire filtro stagione"
        DoCmd.Hourglass False
        Exit Sub
    End If
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-MasterDataArticoliNoListini-(" & Me.FiltroStagioneEAN & ")-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    'exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ItemMasterData", exportFileName, True
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ItemMasterData_NoPriceLists", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:4935-4952
/* Private Sub tastoMasterDataArticoliPrezziAcquisto_Click */
Private Sub tastoMasterDataArticoliPrezziAcquisto_Click()
    If IsNull(Me.FiltroStagioneEAN) Or Me.FiltroStagioneEAN = "" Then
        MsgBox "Inserire filtro stagione"
        DoCmd.Hourglass False
        Exit Sub
    End If
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-MasterDataArticoliPrezziAcquisti-(" & Me.FiltroStagioneEAN & ")-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    'exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ItemMasterData", exportFileName, True
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ItemMasterData_PurchasePrice", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:4954-4990
/* Private Sub tastoMasterDataArticoliPrezziFOBEXW_Click */
Private Sub tastoMasterDataArticoliPrezziFOBEXW_Click()
    If DataFinale.Value = "" Or IsNull(DataFinale) = True Then
            MsgBox "Inserire data finale nel tab area amministrativa"
            Exit Sub
    End If
    If IsNull(Me.FiltroStagioneEAN) Or Me.FiltroStagioneEAN = "" Then
        MsgBox "Inserire filtro stagione"
        DoCmd.Hourglass False
        Exit Sub
    End If
    
    Dim RES As Integer
    RES = MsgBox("Attenzione deve essere eseguita da un utente per volta. Procedere?", vbYesNo)
    If RES <> 6 Then Exit Sub
    
    DoCmd.Hourglass True
    
    ' per accelerare sostanzialmente il calcolo si creano dati in una tabella di appoggio, svuotata preventivamente
    CurrentDb.Execute "delete from ValutazioneMagazzinoTabella"
    
    Dim qdf As QueryDef
    Set qdf = CurrentDb.QueryDefs("valutazionemagazzino_costi_creadati")
    qdf.Parameters("[forms]![principale]![datafinale]") = Me.DataFinale
    qdf.Execute
    
    
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-MasterDataArticoli_EXWFOB-(" & Me.FiltroStagioneEAN & ")-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    'exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ItemMasterData", exportFileName, True
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ItemMasterData_EXWFOB", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:4992-5005
/* Private Sub TastoMerceRicevutaAllaData_Click */
Private Sub TastoMerceRicevutaAllaData_Click()
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-MerceRicevutaAllaData-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "CarichiAllaData", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:5007-5025
/* Private Sub TastoNDCRegistrateEResi_Click */
Private Sub TastoNDCRegistrateEResi_Click()
    If DataIniziale.Value = "" Or IsNull(DataIniziale) = True Or DataFinale.Value = "" Or IsNull(DataFinale) = True Then
        MsgBox "Inserire periodo"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-NDCRegistrateEResi-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "NDCRegistrateEResi", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:5027-5045
/* Private Sub TastoNDCRegistrateEResi_nonfatturati_Click */
Private Sub TastoNDCRegistrateEResi_nonfatturati_Click()
    If DataIniziale.Value = "" Or IsNull(DataIniziale) = True Or DataFinale.Value = "" Or IsNull(DataFinale) = True Then
        MsgBox "Inserire periodo"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-NDCRegistrateEResi-NON Fatturato-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "NDCRegistrateEResi-solononfatturato", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:5047-5062
/* Private Sub TastoNegozioEstraiListaDaBolla_Click */
Private Sub TastoNegozioEstraiListaDaBolla_Click()
    MsgBox "Funzione Obsoleta"
    Exit Sub
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-CaricoNegozioOutletDaDDT-" & SostituisciBarraConMeno(Me.FiltroDDTPerNegozioOutlet) & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "CarichiNegozioOutletDaDDT", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:5064-5079
/* Private Sub TastoNegozioEstraiListaDaResoTrasferimento_Click */
Private Sub TastoNegozioEstraiListaDaResoTrasferimento_Click()
    DoCmd.Hourglass True
    Dim exportFileName As String
    ' salvare con formato xls e in posizione fissa
    exportFileName = nomeAzienda & "-ResoCaricoNegozioOutletDaTrasferimento-" & SostituisciBarraConMeno(Me.FiltroODTPerNegozioOutlet) & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    ' exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xls"
    exportFileName = "X:\CarichiNegozioESpaccio\" & exportFileName & ".xls"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel9, "CarichiNegozioOutletDaResoTrasferimento", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:5081-5096
/* Private Sub TastoNegozioEstraiListaDaTrasferimento_Click */
Private Sub TastoNegozioEstraiListaDaTrasferimento_Click()
    DoCmd.Hourglass True
    Dim exportFileName As String
    ' salvare con formato xls e in posizione fissa
    exportFileName = nomeAzienda & "-CaricoNegozioOutletDaTrasferimento-" & SostituisciBarraConMeno(Me.FiltroODTPerNegozioOutlet) & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    ' exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xls"
    exportFileName = "X:\CarichiNegozioESpaccio\" & exportFileName & ".xls"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel9, "CarichiNegozioOutletDaTrasferimento", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:5098-5109
/* Private Sub TastoPaiaSpedite_Click */
Private Sub TastoPaiaSpedite_Click()
    If livelloUtente >= 1 Then
        If DataIniziale.Value = "" Or IsNull(DataIniziale) = True Or DataFinale.Value = "" Or IsNull(DataFinale) = True Then
            MsgBox "Inserire periodo"
            Exit Sub
        End If
        DoCmd.OpenQuery "AAA-PaiaSpediteStefania", acViewNormal, acReadOnly
    Else
        MsgBox "Privilegio non sufficiente"
    End If

End Sub

GO

-- Form_Principale:5111-5113
/* Private Sub TastoParametriFornitori_Click */
Private Sub TastoParametriFornitori_Click()
    DoCmd.OpenForm "fornitori"
End Sub

GO

-- Form_Principale:5115-5118
/* Private Sub TastoParametriMarchi_Click */
Private Sub TastoParametriMarchi_Click()
    DoCmd.OpenForm "marchi"

End Sub

GO

-- Form_Principale:5120-5140
/* Private Sub TastoPrenotazioniEVenditePerTaglia_Click */
Private Sub TastoPrenotazioniEVenditePerTaglia_Click()
    If Me.FiltroMarchioSourcing = "" Or IsNull(Me.FiltroMarchioSourcing) = True Or Me.FiltroStagioneSourcing = "" Or IsNull(Me.FiltroStagioneSourcing) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    DoCmd.Hourglass True
    ' estrazione tabella
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-PrenotazioniEVenditeTaglia-(" & Me.FiltroStagioneSourcing & "_" & Me.FiltroMarchioSourcing & ")-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PrenotazioniEVenditeTaglia", exportFileName, True

    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"


    ' EstrazioneStatisticheGenericaPerStagione "VendutoCompratoProiezione", "VendutoCompratoProiezione", "where"
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:5142-5160
/* Private Sub TastoProspettoProvvigioniStagioneMarchio_Click */
Private Sub TastoProspettoProvvigioniStagioneMarchio_Click()
    'If DataIniziale.Value = "" Or IsNull(DataIniziale) = True Or DataFinale.Value = "" Or IsNull(DataFinale) = True Then
    '    MsgBox "Inserire periodo"
    '    Exit Sub
    'End If
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-ProspettoProvvigioniPerStagioneMarchio-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ProspettoProvvigioniStagioneMarchio", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:5162-5180
/* Private Sub TastoProvvigioniPerStagione_Click */
Private Sub TastoProvvigioniPerStagione_Click()
    If DataIniziale.Value = "" Or IsNull(DataIniziale) = True Or DataFinale.Value = "" Or IsNull(DataFinale) = True Then
        MsgBox "Inserire periodo"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-ProvvigioniPerStagione-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ProvvigioniPerStagione", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:5182-5201
/* Private Sub TastoProvvigioniPerStagioneDettaglioLiquidazioni_Click */
Private Sub TastoProvvigioniPerStagioneDettaglioLiquidazioni_Click()
    If DataIniziale.Value = "" Or IsNull(DataIniziale) = True Or DataFinale.Value = "" Or IsNull(DataFinale) = True Then
        MsgBox "Inserire periodo"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-ProvvigioniPerStagioneDettaglioLiquidazioni-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ProvvigioniPerStagione-DettaglioLiquidazioni", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"


End Sub

GO

-- Form_Principale:5203-5217
/* Private Sub TastoRDAAvanzamento_Click */
Private Sub TastoRDAAvanzamento_Click()
    If Me.CreditoFiltroStagione2 = "" Or IsNull(Me.CreditoFiltroStagione2) = True Then
        MsgBox "Inserire la stagione da analizzare"
        Exit Sub
    End If
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-GrigliaRDA_Avanzamento-" & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "RDADaRicevere_Sommario", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:5219-5232
/* Private Sub TastoRDATitoliDaRicevere_Click */
Private Sub TastoRDATitoliDaRicevere_Click()
    If Me.CreditoFiltroStagione2 = "" Or IsNull(Me.CreditoFiltroStagione2) = True Or Me.filtroAgentePerGrigliaAgenti = "" Or IsNull(Me.filtroAgentePerGrigliaAgenti) = True Then
        MsgBox "Inserire la stagione da analizzare e l'agente da estrarre"
        Exit Sub
    End If
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-GrigliaRDADARicevere-" & Me.nomeagentenascosto & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "RDADaRicevere", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"
End Sub

GO

-- Form_Principale:5234-5262
/* Private Sub TastoRefreshLista_Click */
Private Sub TastoRefreshLista_Click()
    
    
    Dim oFile       As Object
    Dim oFSO        As Object
    Dim oFolder     As Object
    Dim oFiles      As Object

    Dim i As Integer
    Dim count As Integer
    ' Pulisce la lista dei files
    Do While CasellaFileControllo.ListCount > 0
        CasellaFileControllo.RemoveItem (0)
    Loop
    
    Set oFSO = CreateObject("Scripting.FileSystemObject")
    Set oFolder = oFSO.GetFolder(Me.percorsoSalvataggioLetture)
    Set oFiles = oFolder.Files
    If oFiles.count > 0 Then

        For Each oFile In oFiles
            CasellaFileControllo.AddItem (oFile.Name)
        Next
    End If

    'Debug.Print CasellaFileControllo.Value

    
End Sub

GO

-- Form_Principale:5264-5291
/* Private Sub TastoRefreshListaResi_Click */
Private Sub TastoRefreshListaResi_Click()
    
    
    Dim oFile       As Object
    Dim oFSO        As Object
    Dim oFolder     As Object
    Dim oFiles      As Object

    Dim i As Integer
    Dim count As Integer
    ' Pulisce la lista dei files
    Do While CasellaFileControlloResi.ListCount > 0
        CasellaFileControlloResi.RemoveItem (0)
    Loop
    
    Set oFSO = CreateObject("Scripting.FileSystemObject")
    Set oFolder = oFSO.GetFolder(Me.percorsoSalvataggioLettureResi)
    Set oFiles = oFolder.Files
    If oFiles.count > 0 Then

        For Each oFile In oFiles
            CasellaFileControlloResi.AddItem (oFile.Name)
        Next
    End If

    'Debug.Print CasellaFileControllo.Value

End Sub

GO

-- Form_Principale:5293-5306
/* Private Sub TastoReportVendutoCompratononProiettato_Click */
Private Sub TastoReportVendutoCompratononProiettato_Click()
    If Me.FiltroMarchio = "" Or IsNull(Me.FiltroMarchio) = True Or Me.FiltroStagione = "" Or IsNull(Me.FiltroStagione) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    Dim filterTmp As String
    filterTmp = "[Trademark Code]='" & Me.FiltroMarchio & "'  and " & "[Season Code]='" & Me.FiltroStagione & "'"
    If Me.FiltroCollezione <> "" Then filterTmp = filterTmp & " and [Collection Code]='" & Me.FiltroCollezione & "'"
    If Me.FiltroGenere <> "" Then filterTmp = filterTmp & " and [product sex]='" & Me.FiltroGenere & "'"
    DoCmd.Hourglass True
    DoCmd.OpenReport "MiglioriArticoliVenduti-LineaModello-VendutocompratoNonProiet", acViewPreview, , filterTmp
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:5308-5322
/* Private Sub TastoRicercaAnomalie_Click */
Private Sub TastoRicercaAnomalie_Click()
    If Me.CreditoFiltroStagione2 = "" Or IsNull(Me.CreditoFiltroStagione2) = True Then
        MsgBox "Inserire la stagione da analizzare"
        Exit Sub
    End If
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-DatiAnomalieOrdini-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "AnalisiCredito-RicercaAnomalie_final", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:5324-5338
/* Private Sub TastoRicercaCCBancariMancanti_Click */
Private Sub TastoRicercaCCBancariMancanti_Click()

    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-CCBancariMancanti-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "Ricerca CC Bancari Mancanti", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:5340-5342
/* Private Sub TastoRicercaCodiceBox_Click */
Private Sub TastoRicercaCodiceBox_Click()
    DoCmd.OpenQuery "RicercaWSM_CodiceBox", acViewNormal, acReadOnly
End Sub

GO

-- Form_Principale:5344-5346
/* Private Sub TastoRicercaEANUPC_Click */
Private Sub TastoRicercaEANUPC_Click()
    DoCmd.OpenQuery "ricercaeanupc", acViewNormal, acReadOnly
End Sub

GO

-- Form_Principale:5348-5364
/* Private Sub TastoRicercaFatturePerResi_Click */
Private Sub TastoRicercaFatturePerResi_Click()
    If IsNull(Me.FiltroClienteEAN) Or Me.FiltroClienteEAN = "" Or Me.Item_Control.Value = "" Or IsNull(Me.Item_Control) = True Or Me.Item_Control.Value = "" Or IsNull(Me.Item_Control) = True Then
        MsgBox "Inserire filtri articolo colore e codice cliente"
        Exit Sub
    End If

    DoCmd.Hourglass True
  
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-FatturePerResi-" & Me.FiltroClienteEAN & "-" & Me.FiltroEANFatt & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "RigaFatturaPerresi", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:5366-5400
/* Private Sub TastoRicercaQueryPerTabella_Click */
Private Sub TastoRicercaQueryPerTabella_Click()
    Dim exportFileName As String
    Dim RES As String
    Dim qdf As QueryDef
    Dim rst As DAO.Recordset
    
    RES = InputBox("Tabella da ricercare nelle query")
    DoCmd.Hourglass True
    
    CurrentDb.Execute ("Delete from TabelleInQuery")
    Set rst = CurrentDb.OpenRecordset("TabelleInQuery")
    
    
    For Each qdf In CurrentDb.QueryDefs
        If InStr(qdf.SQL, RES) > 0 Then
            Debug.Print qdf.Name
            rst.AddNew
            rst!tabella = RES
            rst!Query = qdf.Name
            rst.Update
        End If
    Next
    
    rst.Close
    
    exportFileName = Me.PercorsoSalvataggio & "\" & nomeAzienda & "\QueryPerTabella_" & RES & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "TabelleInQuery", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:5402-5416
/* Private Sub TastoRieplilogoRDAeBloccati_Click */
Private Sub TastoRieplilogoRDAeBloccati_Click()
    If Me.CreditoFiltroStagione2 = "" Or IsNull(Me.CreditoFiltroStagione2) = True Then
        MsgBox "Inserire la stagione da analizzare"
        Exit Sub
    End If
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-GrigliaRiepilogoRDAeBloccati-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "RDADaRicevere_Riepilogo", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:5418-5436
/* Private Sub TastoSaldoClienti_Click */
Private Sub TastoSaldoClienti_Click()
    If DataFinale.Value = "" Or IsNull(DataFinale) = True Then
            MsgBox "Inserire data finale"
            Exit Sub
    End If

    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-SaldoClienti-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "SaldoAllaDataClienti", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:5438-5455
/* Private Sub TastoSaldoFornitori_Click */
Private Sub TastoSaldoFornitori_Click()
    If DataFinale.Value = "" Or IsNull(DataFinale) = True Then
            MsgBox "Inserire data finale"
            Exit Sub
    End If

    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-SaldoFornitori-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "SaldoAllaDataFornitori", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"
End Sub

GO

-- Form_Principale:5457-5472
/* Private Sub TastoScrittureWarehouseEntryErrate_Click */
Private Sub TastoScrittureWarehouseEntryErrate_Click()
    
    
    DoCmd.Hourglass True
    
    ' estrazione tabella
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-WMS_WarehouseEntry_Errate-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "WMS_WarehouseEntry_Errate", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:5474-5476
/* Private Sub TastoSellToBillTo_Click */
Private Sub TastoSellToBillTo_Click()
    DoCmd.OpenQuery ("sell to different from bill to")
End Sub

GO

-- Form_Principale:5478-5487
/* Private Sub TastoSemplificaSQLQueries_Click */
Private Sub TastoSemplificaSQLQueries_Click()
    If livelloUtente >= 3 Then
        semplificaSQLQueries

    Else
        MsgBox "Privilegio non sufficiente"
    End If


End Sub

GO

-- Form_Principale:5489-5492
/* Private Sub TastoSistemaBolleBRT_Click */
Private Sub TastoSistemaBolleBRT_Click()
    CurrentDb.Execute ("aggiornaBolle DE FR per TNT")
    MsgBox "Aggiornamento Completato"
End Sub

GO

-- Form_Principale:5494-5499
/* Private Sub TastoSistemaBolleTNTaBRT_Click */
Private Sub TastoSistemaBolleTNTaBRT_Click()
    CurrentDb.Execute ("aggiornaBolle RILASCIATE da TNT a BRT ITALIA")
    CurrentDb.Execute ("aggiornaBolle RILASCIATE da TNT a BRT ESTERO")
    MsgBox "Aggiornamento Completato"

End Sub

GO

-- Form_Principale:5501-5507
/* Private Sub TastoSistemaLimkedDocuments_Click */
Private Sub TastoSistemaLimkedDocuments_Click()
    DoCmd.Hourglass True
    CurrentDb.Execute "SistemaLinkedDocuments"
    DoCmd.Hourglass False
    MsgBox "Sistemazione completata"
    
End Sub

GO

-- Form_Principale:5509-5518
/* Private Sub TastoSistemazionePreventivaWarehouseJournal_Click */
Private Sub TastoSistemazionePreventivaWarehouseJournal_Click()
    Dim pwd As String
    pwd = InputBox("Inserire la password")
    If pwd = "elisaclaudia" Then
        DoCmd.OpenQuery "WMS_SistemazioneJournal_Righe", acViewNormal, acEdit
    Else
        MsgBox "password errata"
    End If

End Sub

GO

-- Form_Principale:5520-5537
/* Private Sub TastoSoggettiProvvigioniControllo_Click */
Private Sub TastoSoggettiProvvigioniControllo_Click()
    'If DataIniziale.Value = "" Or IsNull(DataIniziale) = True Or DataFinale.Value = "" Or IsNull(DataFinale) = True Then
    '    MsgBox "Inserire periodo"
    '    Exit Sub
    'End If
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-ControlloSoggettiEProvvigioniFattureNdc-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "SoggettiProvvigionaliControlloFattureENoteDiCredito", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"
End Sub

GO

-- Form_Principale:5539-5549
/* Private Sub TastoSollecitiConSimulate_Click */
Private Sub TastoSollecitiConSimulate_Click()
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-SollecitiConSimulate-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "SollecitiConSimulate", exportFileName, True
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:5551-5570
/* Private Sub TastoSpedizioni_Click */
Private Sub TastoSpedizioni_Click()
    If IsNull(Me.FiltroStagioneEAN2) Or Me.FiltroStagioneEAN2 = "" Then
        MsgBox "Inserire stagione"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-SituazioneSpedizioni-" & Me.FiltroAgenteExportDDT & "-" & Me.FiltroStagioneEAN2 & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "SituazioneSpedizioni", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"


End Sub

GO

-- Form_Principale:5572-5590
/* Private Sub TastoSpedizioniAgente_Click */
Private Sub TastoSpedizioniAgente_Click()
    If IsNull(Me.FiltroStagioneEAN2) Or Me.FiltroStagioneEAN2 = "" Or Me.FiltroAgenteExportDDT = "" Or IsNull(Me.FiltroAgenteExportDDT) = True Then
        MsgBox "Inserire stagione e codice agente"
        Exit Sub
    End If
    
    DoCmd.Hourglass True
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-SituazioneSpedizioniAgente-" & Me.FiltroAgenteExportDDT & "-" & Me.FiltroStagioneEAN2 & "-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
    
    ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
        'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
        DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "SituazioneSpedizioniAgenti", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:5592-5595
/* Private Sub TastoStampaAllocazioniBlac_Click */
Private Sub TastoStampaAllocazioniBlac_Click()
        DoCmd.OpenReport "Allocazioni_Blac", acViewPreview, , "[no_]='" & Forms!principale!NumeroSPD & "'"

End Sub

GO

-- Form_Principale:5597-5650
/* Private Sub TastoStampaMassivaSovraccolliDaAnagrafica_Click */
Private Sub TastoStampaMassivaSovraccolliDaAnagrafica_Click()
    Dim rstDest As DAO.Recordset, rstOrig As DAO.Recordset
    CurrentDb.Execute ("delete * from tabellaappoggio")
    
    Dim qdf As DAO.QueryDef
    
    Set qdf = CurrentDb.QueryDefs("StampaMassivaSovraccolliDaAnagrafica")
    qdf.Parameters("forms!principale!numeropezzipercartone") = Me.NumeroPezziPerCartone
    
    Set rstOrig = qdf.OpenRecordset
    'Set rstOrig = CurrentDb.OpenRecordset("StampaMassivaSovraccolliDaAnagrafica")
    Set rstDest = CurrentDb.OpenRecordset("TabellaAppoggio")
    
    If rstOrig.RecordCount > 0 Then
        While rstOrig.EOF = False
            Dim i As Integer
            For i = 1 To rstOrig!cartoni
                rstDest.AddNew
                rstDest!numeroBPR = rstOrig![Document No_]
               
                rstDest!CodiceCliente = rstOrig![Bill-to Customer No_]
                rstDest!DescrizioneCliente1 = rstOrig![Bill-to Name]
                rstDest!DescrizioneCliente2 = rstOrig![Bill-to Name 2]
                rstDest!IndirizzoCliente1 = rstOrig![Bill-to Address]
                rstDest!IndirizzoCliente2 = rstOrig![Bill-to Address 2]
                rstDest!CapCliente = rstOrig![Bill-to Post Code]
                rstDest!CittaCliente = rstOrig![Bill-to City]
                rstDest!ProvinciaCliente = rstOrig![Bill-to County]
                rstDest!PaeseCliente = rstOrig![Bill-to Country_Region Code]
                rstDest!CodiceDestino = rstOrig![Ship-to Code]
                rstDest!DescrizioneDestino1 = rstOrig![Ship-to Name]
                rstDest!DescrizioneDestino2 = rstOrig![Ship-to Name 2]
                rstDest!IndirizzoDestino1 = rstOrig![Ship-to Address]
                rstDest!IndirizzoDestino2 = rstOrig![Ship-to Address 2]
                rstDest!CapDestino = rstOrig![Ship-to Post Code]
                rstDest!CittaDestino = rstOrig![Ship-to City]
                rstDest!ProvinciaDestino = rstOrig![Ship-to County]
                rstDest!PaeseDestino = rstOrig![Ship-to Country_Region Code]
                rstDest!ReferenzaOrdineCliente = ""
                rstDest!RiferimentoOrdineCliente = ""
                
                rstDest.Update
                
            Next i
            rstOrig.MoveNext
        Wend
        rstDest.Close
        rstOrig.Close
       
    End If
    DoCmd.OpenReport "reportok", acViewPreview


End Sub

GO

-- Form_Principale:5652-5664
/* Private Sub TastoStimaRedditivitaPostCampagnaVendite_Click */
Private Sub TastoStimaRedditivitaPostCampagnaVendite_Click()
    MsgBox "Attenzione. Funzione in fase di definizione. Verificare defizione e valorizzazione parametri."
    If IsNull(Forms!principale!FattoreCorrettivo) = True Then
        MsgBox ("Selezionare un fattore correttivo")
        Exit Sub
    End If
    If IsNull(Forms!principale!cambioeurodollaro) = True Then
        MsgBox ("Selezionare un tasso di cambio Euro Dollaro")
        Exit Sub
    End If
    If nomeUtente = "az" Or nomeUtente = "fabiano" Then DoCmd.OpenQuery "def01-StimaRedditivitaFineStagioneVendite-PIVOT", acViewPivotChart, acReadOnly

End Sub

GO

-- Form_Principale:5666-5722
/* Private Sub TastoSvalutaValA_Click */
Private Sub TastoSvalutaValA_Click()
    Dim RES As Integer
    RES = MsgBox("Procedere con la svalutazione?", vbYesNo)
    If RES <> 6 Then Exit Sub
    
    If livelloUtente >= 2 Then
        If Me.DataSvalutazioneMagazzino.Value = "" Or IsNull(DataSvalutazioneMagazzino) = True Or PercentualeSvalutazioneVALA = "" Or IsNull(PercentualeSvalutazioneVALA) = True Or Me.FiltroStagionePerSvalutazione.Value = "" Or IsNull(FiltroStagionePerSvalutazione) = True Or Me.FiltroMarchioPerSvalutazione.Value = "" Or IsNull(FiltroMarchioPerSvalutazione) = True Then
            MsgBox "Inserire data, percentuale e filtri marchio e stagione per svalutazione"
            Exit Sub
        End If
        DoCmd.Hourglass True
        
        ' SUBITO METTE IL FLAG DI NECESSARIA GENERAZIONE SUGLI ARTICOLI CHE VERRANNO MODIFICATI
        Dim qdf As QueryDef
        Dim ExecDateTime
        ExecDateTime = Now
        ' nb necessario eseguire codice in quanto risultano query non aggiornabili
        Dim rst As DAO.Recordset
        Dim rstDest As DAO.Recordset
        Set qdf = CurrentDb.QueryDefs("ValutazioneMagazzino_SvalutazioneValA_Select")
        qdf.Parameters("[forms]![principale]![filtromarchiopersvalutazione]") = Me.FiltroMarchioPerSvalutazione
        qdf.Parameters("[forms]![principale]![filtrostagionepersvalutazione]") = Me.FiltroStagionePerSvalutazione
        Set rst = qdf.OpenRecordset
        If rst.RecordCount > 0 Then
            rst.MoveFirst
            While rst.EOF = False
                Set rstDest = CurrentDb.OpenRecordset("select [Model Item No_],[Model Changed On DateTime] from Item where NO_='" & rst![Model Item No_] & "'")
                rstDest.Edit
                rstDest![Model Changed On DateTime] = ExecDateTime
                rstDest.Update
                rst.MoveNext
            Wend
            rstDest.Close
            rst.Close
        End If
        
        
        ' POI SI ESEGUE LA SVALUTAZIONE DI VAL A (PRENDE ULTIMO VAL A PRESENTE PER SINGOLO ARTICOLO"
        ' MODEL ITEM
        Set qdf = CurrentDb.QueryDefs("ValutazioneMagazzino_SvalutazioneValA")
        qdf.Parameters("[Forms]![principale]![DataSvalutazioneMagazzino]") = Me.DataSvalutazioneMagazzino
        ' aaa verificare motivazione. non chiaro significato. riga inserita forzata il 07/03/17
        ' per evitare il too few parameters
        qdf.Parameters("[Forms]![principale]![datacreazionevalorimagazzino]") = Me.DataSvalutazioneMagazzino
        qdf.Parameters("[Forms]![principale]![PercentualeSvalutazioneVALA]") = Me.PercentualeSvalutazioneVALA
        qdf.Parameters("[forms]![principale]![filtromarchiopersvalutazione]") = Me.FiltroMarchioPerSvalutazione
        qdf.Parameters("[forms]![principale]![filtrostagionepersvalutazione]") = Me.FiltroStagionePerSvalutazione
        qdf.Execute
        
        DoCmd.Hourglass False
        MsgBox "Crezione Completata"
    
    Else
        MsgBox "Privilegio non sufficiente"
    End If

End Sub

GO

-- Form_Principale:5724-5739
/* Private Sub TastoTempiPagamento_Click */
Private Sub TastoTempiPagamento_Click()
    If Me.DataIniziale = "" Or IsNull(Me.DataIniziale) = True Or Me.DataFinale = "" Or IsNull(Me.DataFinale) = True Or Me.DataPagamentoPosizioniScoperte = "" Or IsNull(Me.DataPagamentoPosizioniScoperte) = True Or Me.NumeroGiorniSoglia = "" Or IsNull(Me.NumeroGiorniSoglia) = True Then
        MsgBox "Inserire periodo, data pagamento posizioni scoperte e numero giorni soglia (pagamento e ritardo)"
        Exit Sub
    End If
    Dim filtroopzionale As String
    filtroopzionale = ""
    If Me.filtroagentetempipagamento <> "" Then
        filtroopzionale = filtroopzionale & " and [codiceagente]='" & filtroagentetempipagamento & " '"
    End If
    If Me.FiltroMarchioTempiPagamento <> "" Then
        filtroopzionale = filtroopzionale & " and [dimMarchio]='" & Me.FiltroMarchioTempiPagamento & " '"
    End If
    
    DoCmd.OpenReport "reportTempiPagamento", acViewPreview, , "[Datafattura]>=" & "#" & restituisciDataComeStringa(DataIniziale) & "# and " & "[DataFattura]<=" & "#" & restituisciDataComeStringa(DataFinale) & "#" & filtroopzionale
End Sub

GO

-- Form_Principale:5741-5755
/* Private Sub TastoTop40_Click */
Private Sub TastoTop40_Click()
    sistemaquerysolostagionaleepronto
    If Me.FiltroMarchio = "" Or IsNull(Me.FiltroMarchio) = True Or Me.FiltroStagione = "" Or IsNull(Me.FiltroStagione) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    Dim filterTmp As String
    filterTmp = "[Marchio]='" & Me.FiltroMarchio & "'  and " & "[Stagione]='" & Me.FiltroStagione & "'"
    If Me.FiltroCollezione <> "" Then filterTmp = filterTmp & " and [Collection Code]='" & Me.FiltroCollezione & "'"
    If Me.FiltroGenere <> "" Then filterTmp = filterTmp & " and [GenereProdotto]='" & Me.FiltroGenere & "'"
    DoCmd.Hourglass True
    DoCmd.OpenReport "MiglioriArticoliVenduti", acViewPreview, , filterTmp
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:5757-5771
/* Private Sub TastoTop40Fornitore_Click */
Private Sub TastoTop40Fornitore_Click()
    sistemaquerysolostagionaleepronto
    If Me.FiltroMarchio = "" Or IsNull(Me.FiltroMarchio) = True Or Me.FiltroStagione = "" Or IsNull(Me.FiltroStagione) = True Or Me.filtroFornitore = "" Or IsNull(Me.filtroFornitore) = True Then
        MsgBox "Inserire marchio, stagione e fornitore"
        Exit Sub
    End If
    'Dim filterTmp As String
    'filterTmp = "[Marchio]='" & Me.FiltroMarchio & "'  and " & "[Stagione]='" & Me.FiltroStagione & "'"
    'If Me.FiltroCollezione <> "" Then filterTmp = filterTmp & " and [Collection Code]='" & Me.FiltroCollezione & "'"
    'If Me.FiltroGenere <> "" Then filterTmp = filterTmp & " and [GenereProdotto]='" & Me.FiltroGenere & "'"
    DoCmd.Hourglass True
    DoCmd.OpenReport "MiglioriArticoliVenduti-Fornitore", acViewPreview
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:5773-5787
/* Private Sub TastoTop40Articolo_Click */
Private Sub TastoTop40Articolo_Click()
    sistemaquerysolostagionaleepronto
    If Me.FiltroMarchio = "" Or IsNull(Me.FiltroMarchio) = True Or Me.FiltroStagione = "" Or IsNull(Me.FiltroStagione) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    Dim filterTmp As String
    filterTmp = "[Marchio]='" & Me.FiltroMarchio & "'  and " & "[Stagione]='" & Me.FiltroStagione & "'"
    If Me.FiltroCollezione <> "" Then filterTmp = filterTmp & " and [Collection Code]='" & Me.FiltroCollezione & "'"
    If Me.FiltroGenere <> "" Then filterTmp = filterTmp & " and [GenereProdotto]='" & Me.FiltroGenere & "'"
    DoCmd.Hourglass True
    DoCmd.OpenReport "MiglioriArticoliVenduti-Modello", acViewPreview, , filterTmp
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:5789-5803
/* Private Sub TastoTop40ArticoloFornitore_Click */
Private Sub TastoTop40ArticoloFornitore_Click()
    sistemaquerysolostagionaleepronto
    If Me.FiltroMarchio = "" Or IsNull(Me.FiltroMarchio) = True Or Me.FiltroStagione = "" Or IsNull(Me.FiltroStagione) = True Or Me.filtroFornitore = "" Or IsNull(Me.filtroFornitore) = True Then
        MsgBox "Inserire marchio, stagione e fornitore"
        Exit Sub
    End If
    'Dim filterTmp As String
    'filterTmp = "[Marchio]='" & Me.FiltroMarchio & "'  and " & "[Stagione]='" & Me.FiltroStagione & "'"
    'If Me.FiltroCollezione <> "" Then filterTmp = filterTmp & " and [Collection Code]='" & Me.FiltroCollezione & "'"
    'If Me.FiltroGenere <> "" Then filterTmp = filterTmp & " and [GenereProdotto]='" & Me.FiltroGenere & "'"
    DoCmd.Hourglass True
    DoCmd.OpenReport "MiglioriArticoliVenduti-Modello-Fornitore", acViewPreview
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:5806-5820
/* Private Sub TastoTop40LineaArticolo_Click */
Private Sub TastoTop40LineaArticolo_Click()
    sistemaquerysolostagionaleepronto
    If Me.FiltroMarchio = "" Or IsNull(Me.FiltroMarchio) = True Or Me.FiltroStagione = "" Or IsNull(Me.FiltroStagione) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    Dim filterTmp As String
    filterTmp = "[Marchio]='" & Me.FiltroMarchio & "'  and " & "[Stagione]='" & Me.FiltroStagione & "'"
    If Me.FiltroCollezione <> "" Then filterTmp = filterTmp & " and [Collection Code]='" & Me.FiltroCollezione & "'"
    If Me.FiltroGenere <> "" Then filterTmp = filterTmp & " and [GenereProdotto]='" & Me.FiltroGenere & "'"
    DoCmd.Hourglass True
    DoCmd.OpenReport "MiglioriArticoliVenduti-LineaModello", acViewPreview, , filterTmp
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:5822-5836
/* Private Sub TastoTop40LineaArticoloFornitore_Click */
Private Sub TastoTop40LineaArticoloFornitore_Click()
    sistemaquerysolostagionaleepronto
    If Me.FiltroMarchio = "" Or IsNull(Me.FiltroMarchio) = True Or Me.FiltroStagione = "" Or IsNull(Me.FiltroStagione) = True Or Me.filtroFornitore = "" Or IsNull(Me.filtroFornitore) = True Then
        MsgBox "Inserire marchio, stagione e fornitore"
        Exit Sub
    End If
    'Dim filterTmp As String
    'filterTmp = "[Marchio]='" & Me.FiltroMarchio & "'  and " & "[Stagione]='" & Me.FiltroStagione & "'"
    'If Me.FiltroCollezione <> "" Then filterTmp = filterTmp & " and [Collection Code]='" & Me.FiltroCollezione & "'"
    'If Me.FiltroGenere <> "" Then filterTmp = filterTmp & " and [GenereProdotto]='" & Me.FiltroGenere & "'"
    DoCmd.Hourglass True
    DoCmd.OpenReport "MiglioriArticoliVenduti-LineaModello-Fornitore", acViewPreview
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:5838-5852
/* Private Sub TastoTop40LineaArticoloFotoGrandi_Click */
Private Sub TastoTop40LineaArticoloFotoGrandi_Click()
    sistemaquerysolostagionaleepronto
    If Me.FiltroMarchio = "" Or IsNull(Me.FiltroMarchio) = True Or Me.FiltroStagione = "" Or IsNull(Me.FiltroStagione) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    Dim filterTmp As String
    filterTmp = "[Marchio]='" & Me.FiltroMarchio & "'  and " & "[Stagione]='" & Me.FiltroStagione & "'"
    If Me.FiltroCollezione <> "" Then filterTmp = filterTmp & " and [Collection Code]='" & Me.FiltroCollezione & "'"
    If Me.FiltroGenere <> "" Then filterTmp = filterTmp & " and [GenereProdotto]='" & Me.FiltroGenere & "'"
    DoCmd.Hourglass True
    DoCmd.OpenReport "MiglioriArticoliVenduti-LineaModello_MediaRisoluzione", acViewPreview, , filterTmp
    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:5854-5941
/* Private Sub TastoTranscodificaEDICarryOver_Click */
Private Sub TastoTranscodificaEDICarryOver_Click()
    DoCmd.Hourglass True
    
    Dim Percorso As String
    Dim PercorsoOut As String
    Dim OutputFile As String
    Dim x As Integer
    Dim rst As DAO.Recordset
    
    Dim fso As New FileSystemObject
    Dim tsIn As TextStream
    Dim tsOut As TextStream
    Dim codArt As String
    Dim leftPart As String, rightPart As String
    Dim tmpStr As String
    Dim V(1000) As String
    Dim i As Integer
    
    Percorso = EDICheckFolder & "\in"
    PercorsoOut = EDICheckFolder & "\out"
    'OutputFile = "Z:\Condivisa\vari\adalberto\lavoro\febos-new\VarieAccessRecentiInCorso\coin\DatiRicevuti\201103-globalePastedMarzo.txt"
    
    'Add the files to the folder.
    Dim strTemp As String
    strTemp = Dir(Percorso & "\*.*")
    i = 1
    Do While strTemp <> vbNullString
        Debug.Print strTemp
        V(i) = strTemp
        i = i + 1
        strTemp = Dir
    Loop
    
    ' determina la lista dei file da unire
    'Application.FileSearch.LookIn = Percorso
    'With Application.FileSearch
    '    .FileType = msoFileTypeAllFiles 'get all files
    '    '.FileType = "*"
    '    .SearchSubFolders = False 'search sub directories
    '    .Execute 'run the search
    'End With
    
        
    For x = 1 To i - 1 'for each file found, by the count (or index)
        Debug.Print V(x)
        Set tsIn = fso.OpenTextFile(Percorso & "\" & V(x), ForReading)
        'Open output file.

        Set tsOut = fso.CreateTextFile(PercorsoOut & "\" & V(x), ForWriting)
        
        
        'Loop while not at the end of the file.
        Do While Not tsIn.AtEndOfStream
          tmpStr = tsIn.ReadLine
          Debug.Print tmpStr
          ' determina il codice articolo
          codArt = Mid$(tmpStr, 44, 10)
          ' aggiunge 10 caratteri vuoti se non trovato nella lista carry over
            Set rst = CurrentDb.OpenRecordset("select * from transcodificacarryoverth where codiceth ='" & codArt & "'")
            If rst.RecordCount > 0 Then
                rst.MoveFirst
                codArt = rst!codicefeb + "        "
            Else
                codArt = codArt + "          "
            End If
          ' prima parte sistema la parte relativa al codice articolo
          leftPart = Left$(tmpStr, 43)
          rightPart = Right$(tmpStr, Len(tmpStr) - 53)
          tmpStr = leftPart & codArt & rightPart
          ' seconda parete sostituisce il codice ship-to
          ' ovviamente avendo aggiunto dieci caratteri la posizione dello ship-to si trova di 10 a destra oltre lo standard
          ' nuovo codice mag 0000208239 - vecchio codice mag 0000089838
          leftPart = Left$(tmpStr, 110)
          rightPart = Right$(tmpStr, Len(tmpStr) - 120)
          tmpStr = leftPart & "0000089838" & rightPart
          
          tsOut.WriteLine tmpStr
        Loop
        'Close the file.
        tsIn.Close
        tsOut.Close
    Next x
    
    tsOut.Close
    MsgBox "Conversione files completata per " & i - 1 & " files"
    
    DoCmd.Hourglass False
End Sub

GO

-- Form_Principale:5943-5946
/* Private Sub TastoVariazionePrezzo_Click */
Private Sub TastoVariazionePrezzo_Click()
    MsgBox "Variazione basata su prezzo obiettivo di listino uno definito a livello di singolo articolo modello. Attenzione verificare in presenza di prezzi per taglia o per colore."
    DoCmd.OpenQuery "qSoloVendPerCalcoloScontoSuPrezzoObiettivo-PIVOT", acViewPivotChart, acReadOnly
End Sub

GO

-- Form_Principale:5948-5972
/* Private Sub TastoVenditeSpaccio_Click */
Private Sub TastoVenditeSpaccio_Click()
    If livelloUtente >= 1 Then
        If DataIniziale.Value = "" Or IsNull(DataIniziale) = True Or DataFinale.Value = "" Or IsNull(DataFinale) = True Then
            MsgBox "Inserire periodo"
            Exit Sub
        End If
    
        DoCmd.Hourglass True
        Dim exportFileName As String
        exportFileName = nomeAzienda & "-AnalisiVenditeSpaccio-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
        
        ' DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-stepfinal", exportFileName, True
            'DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "PortafoglioOrdiniCalcoli-step0", exportFileName, True
            DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "VenditeSpaccio", exportFileName, True
        
        DoCmd.Hourglass False
        MsgBox "Estrazione Completata"
    
    
    Else
        MsgBox "Privilegio non sufficiente"
    End If

End Sub

GO

-- Form_Principale:5974-5992
/* Private Sub TastoVenditeTagliaVeloce_Click */
Private Sub TastoVenditeTagliaVeloce_Click()
    If Me.FiltroMarchioSourcing = "" Or IsNull(Me.FiltroMarchioSourcing) = True Or Me.FiltroStagioneSourcing = "" Or IsNull(Me.FiltroStagioneSourcing) = True Then
        MsgBox "Inserire marchio e stagione"
        Exit Sub
    End If
    

    Dim exportFileName As String
    exportFileName = nomeAzienda & "-VendutoTagliaVeloce-(" & Me.FiltroStagioneSourcing & "_" & Me.FiltroMarchioSourcing & ")-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "VenditeTagliaVeloce", exportFileName, True

    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

    DoCmd.Hourglass False

End Sub

GO

-- Form_Principale:5994-6007
/* Private Sub TastoVerificaSpedizioniCosmos_Click */
Private Sub TastoVerificaSpedizioniCosmos_Click()
    DoCmd.Hourglass True
    
    ' estrazione tabella
    Dim exportFileName As String
    exportFileName = nomeAzienda & "WMS_ArticoliCosmos_RunMisti" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "WMS_ArticoliCosmos_RunMisti", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:6009-6028
/* Private Sub TastoWarhouseJournalControllo_Click */
Private Sub TastoWarhouseJournalControllo_Click()
    
    MsgBox "Verificare se vi sono righe zoppe, dove c'è il From Bin Code ma manca il To Bin Code, che possono dare luogo a discrepanze tra giacenza 1_NAV_STD e 2_NAV_WHSE, che possono provocare prelievi in shortage o blocchi di registrazione"
    MsgBox "Verificare se vi sono righe dove non è presente nessun identificatore di collo, che possono dare luogo a collocazioni non compatibili e blocchi di registrazione"
    MsgBox "Verificare se vi sono righe con quantità diversa da 1"
    MsgBox "Verificare se vi sono righe con To Bin Code identico a From Bin Code"
    
    DoCmd.Hourglass True
    
    ' estrazione tabella
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-WMS_WarehouseJournalControllo-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "WMS_WarehouseJournalControllo", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

End Sub

GO

-- Form_Principale:6030-6049
/* Private Sub TastoWMSControlloQuadraturaGiacenza_Click */
Private Sub TastoWMSControlloQuadraturaGiacenza_Click()
    DoCmd.Hourglass True
    
    ' estrazione tabella
    Dim exportFileName As String
    exportFileName = nomeAzienda & "-WMS_ControlloGiacenza-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
    exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"

    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "WMS_ControlloGiacenza", exportFileName, True
    
    DoCmd.Hourglass False
    MsgBox "Estrazione Completata"

  

    ' EstrazioneStatisticheGenericaPerStagione "VendutoCompratoProiezione", "VendutoCompratoProiezione", "where"
    DoCmd.Hourglass False


End Sub

GO

-- Form_Principale:6051-6070
/* Private Sub TestForecastBudget_Click */
Private Sub TestForecastBudget_Click()
    If livelloUtente >= 1 Then
    
        DoCmd.Hourglass True
        Dim exportFileName As String
        exportFileName = nomeAzienda & "-Forecast-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
        
            DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ForecastBudget", exportFileName, True
        
        DoCmd.Hourglass False
        MsgBox "Estrazione Completata"
    
    
    Else
        MsgBox "Privilegio non sufficiente"
    End If

    
End Sub

GO

-- Form_Principale:6072-6089
/* Private Sub TestForecastBudgetApeE17_Click */
Private Sub TestForecastBudgetApeE17_Click()
    If livelloUtente >= 1 Then
    
        DoCmd.Hourglass True
        Dim exportFileName As String
        exportFileName = nomeAzienda & "-ForecastAPE-E17-" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
        
            DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ForecastBudgetApeE17", exportFileName, True
        
        DoCmd.Hourglass False
        MsgBox "Estrazione Completata"
    
    
    Else
        MsgBox "Privilegio non sufficiente"
    End If
End Sub

GO

-- Form_Principale:6091-6109
/* Private Sub TestForecastBudgetApeE17Globale_Click */
Private Sub TestForecastBudgetApeE17Globale_Click()
    If livelloUtente >= 1 Then
    
        DoCmd.Hourglass True
        Dim exportFileName As String
        exportFileName = nomeAzienda & "-ForecastAPE-E17-Globale" & Format$(Year(Now), "00") & Format$(Month(Now), "00") & Format$(Day(Now), "00") & "-" & Format$(Hour(Now), "00") & Format$(Minute(Now), "00")
        exportFileName = Me.PercorsoSalvataggio & nomeAzienda & "\" & exportFileName & ".xlsx"
        
            DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "ForecastBudgetApeE17-Globale", exportFileName, True
        
        DoCmd.Hourglass False
        MsgBox "Estrazione Completata"
    
    
    Else
        MsgBox "Privilegio non sufficiente"
    End If

End Sub

GO

-- Form_Principale:6111-6113
/* Private Sub TestMostraFiltri_Click */
Private Sub TestMostraFiltri_Click()
    sistemaFiltroStagioneMarchio
End Sub

GO

-- Report_MiglioriArticoliVenduti:4-45
/* Private Sub Corpo_Format */
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
        Me.PaiaTotali.Visible = True
    Else
        Me.EtichettaPaia.Visible = False
        Me.PaiaSKU.Visible = False
        Me.PaiaTotali.Visible = False
    End If
    If Forms!principale.FlagMostraListino = True Then
        Me.ListRetail.Visible = True
        Me.ListWholesale.Visible = True
    Else
        Me.ListRetail.Visible = False
        Me.ListWholesale.Visible = False
    End If
    If Me.ControlloPercorsoImmagine <> "" And IsNull(Me.ControlloPercorsoImmagine) = False Then
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

GO

-- Report_Etichette EANCodeLabelsTMP_con UPC:3-34
/* Private Sub Corpo_Format */
Private Sub Corpo_Format(Cancel As Integer, FormatCount As Integer)
    
    If Forms!principale.FlagImportatoDa = True Then
        Me.EtichettaImportatoDa.Visible = True
        Me.EtichettaDistribuitoDa.Visible = False
    
    Else
        Me.EtichettaImportatoDa.Visible = False
        Me.EtichettaDistribuitoDa.Visible = True
    End If
    If Forms!principale!FlagMostraAzienda = False Then
        Me.EtichettaImportatoDa.Visible = False
        Me.EtichettaDistribuitoDa.Visible = False
    End If

    On Error GoTo err_gest
    If Me.ControlloPercorsoImmagine <> "" Then
        Me.Fotografia.Visible = True
        Me.Fotografia.Picture = Me.ControlloPercorsoImmagine
    Else
        Me.Fotografia.Visible = False
    End If
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

GO

-- Report_Etichette EANCodeLabelsTMP_con UPC:36-45
/* Private Sub Report_Open */
Private Sub Report_Open(Cancel As Integer)
    Dim RES As Integer
    RES = MsgBox("Split per articolo colore", vbYesNo)
    If RES = 6 Then
        Me.IntestazioneGruppo0.ForceNewPage = 1
    Else
        Me.IntestazioneGruppo0.ForceNewPage = 0
    End If
    
End Sub

GO

-- Report_MiglioriArticoliVenduti-Modello:5-48
/* Private Sub Corpo_Format */
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
        Me.PaiaTotali.Visible = True
    Else
        Me.EtichettaPaia.Visible = False
        Me.PaiaSKU.Visible = False
        Me.PaiaArticolo.Visible = False
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

GO

-- Report_MiglioriArticoliVenduti-LineaModello_OLD:4-36
/* Private Sub Corpo_Format */
Private Sub Corpo_Format(Cancel As Integer, FormatCount As Integer)
    On Error GoTo err_gest
    
       If Forms!principale.FlagMostraFornitore = True Then
        Me.VendorNameControl.Visible = True
    Else
        Me.VendorNameControl.Visible = False
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

GO

-- Report_MiglioriArticoliVenduti-Fornitore:4-45
/* Private Sub Corpo_Format */
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
        Me.PaiaTotali.Visible = True
    Else
        Me.EtichettaPaia.Visible = False
        Me.PaiaSKU.Visible = False
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

GO

-- Report_MiglioriArticoliVenduti-LineaModello-Fornitore:4-49
/* Private Sub Corpo_Format */
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

GO

-- Report_MiglioriArticoliVenduti-Modello-Fornitore:4-46
/* Private Sub Corpo_Format */
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
        Me.PaiaTotali.Visible = True
    Else
        Me.EtichettaPaia.Visible = False
        Me.PaiaSKU.Visible = False
        Me.PaiaArticolo.Visible = False
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

GO

-- Report_Etichette EANCodeLabelsTMP_old_20181107:3-37
/* Private Sub Corpo_Format */
Private Sub Corpo_Format(Cancel As Integer, FormatCount As Integer)
    If nomeAzienda = "Febos" Or nomeAzienda = "NewEra" Then
        Me.EtichettaBridge.Visible = False
        Me.EtichettaFebos.Visible = True
    ElseIf nomeAzienda = "bridge" Then
        Me.EtichettaBridge.Visible = True
        Me.EtichettaFebos.Visible = False
    
    Else
    
        Me.EtichettaBridge.Visible = False
        Me.EtichettaFebos.Visible = False
    End If
    If Forms!principale!FlagMostraAzienda = False Then
        Me.EtichettaBridge.Visible = False
        Me.EtichettaFebos.Visible = False
    End If

    On Error GoTo err_gest
    If Me.ControlloPercorsoImmagine <> "" Then
        Me.Fotografia.Visible = True
        Me.Fotografia.Picture = Me.ControlloPercorsoImmagine
    Else
        Me.Fotografia.Visible = False
    End If
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

GO

-- Report_Etichette EANCodeLabelsTMP_old_20181107:39-48
/* Private Sub Report_Open */
Private Sub Report_Open(Cancel As Integer)
    Dim RES As Integer
    RES = MsgBox("Split per articolo colore", vbYesNo)
    If RES = 6 Then
        Me.IntestazioneGruppo0.ForceNewPage = 1
    Else
        Me.IntestazioneGruppo0.ForceNewPage = 0
    End If
    
End Sub

GO

-- Report_ReportOK:3-15
/* Private Sub Corpo_Format */
Private Sub Corpo_Format(Cancel As Integer, FormatCount As Integer)
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

GO

-- Report_ReportOkSovraccolliDaLetture:3-15
/* Private Sub IntestazioneGruppo0_Format */
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

GO

-- Report_EtichetteCampionari:3-45
/* Private Sub Report_Open */
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

GO

-- Report_MiglioriArticoliVenduti-LineaModello-VendutoComprato:4-17
/* Private Sub Corpo_Format */
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

GO

-- Report_EtichetteCampionari_OLD_20181107:3-30
/* Private Sub Report_Open */
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

GO

-- Report_Etichette EANCodeLabelsTMP_old_20190912:3-37
/* Private Sub Corpo_Format */
Private Sub Corpo_Format(Cancel As Integer, FormatCount As Integer)
    If nomeAzienda = "Febos" Or nomeAzienda = "NewEra" Then
        Me.EtichettaBridge.Visible = False
        Me.EtichettaFebos.Visible = True
    ElseIf nomeAzienda = "bridge" Then
        Me.EtichettaBridge.Visible = True
        Me.EtichettaFebos.Visible = False
    
    Else
    
        Me.EtichettaBridge.Visible = False
        Me.EtichettaFebos.Visible = False
    End If
    If Forms!principale!FlagMostraAzienda = False Then
        Me.EtichettaBridge.Visible = False
        Me.EtichettaFebos.Visible = False
    End If

    On Error GoTo err_gest
    If Me.ControlloPercorsoImmagine <> "" Then
        Me.Fotografia.Visible = True
        Me.Fotografia.Picture = Me.ControlloPercorsoImmagine
    Else
        Me.Fotografia.Visible = False
    End If
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

GO

-- Report_Etichette EANCodeLabelsTMP_old_20190912:39-48
/* Private Sub Report_Open */
Private Sub Report_Open(Cancel As Integer)
    Dim RES As Integer
    RES = MsgBox("Split per articolo colore", vbYesNo)
    If RES = 6 Then
        Me.IntestazioneGruppo0.ForceNewPage = 1
    Else
        Me.IntestazioneGruppo0.ForceNewPage = 0
    End If
    
End Sub

GO

-- Report_Etichette EANCodeLabelsTMP_con UPC_OLD_20181108:3-36
/* Private Sub Corpo_Format */
Private Sub Corpo_Format(Cancel As Integer, FormatCount As Integer)
    
    If nomeAzienda = "Febos" Then
        Me.EtichettaBridge.Visible = False
        Me.EtichettaFebos.Visible = True
    ElseIf nomeAzienda = "bridge" Then
        Me.EtichettaBridge.Visible = True
        Me.EtichettaFebos.Visible = False
    Else
        Me.EtichettaBridge.Visible = False
        Me.EtichettaFebos.Visible = False
    End If
    If Forms!principale!FlagMostraAzienda = False Then
        Me.EtichettaBridge.Visible = False
        Me.EtichettaFebos.Visible = False
    End If
    
    On Error GoTo err_gest
    If Me.ControlloPercorsoImmagine <> "" Then
        Me.Fotografia.Visible = True
        Me.Fotografia.Picture = Me.ControlloPercorsoImmagine
    Else
        Me.Fotografia.Visible = False
    End If
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

GO

-- Report_Etichette EANCodeLabelsTMP_con UPC_OLD_20181108:38-47
/* Private Sub Report_Open */
Private Sub Report_Open(Cancel As Integer)
    Dim RES As Integer
    RES = MsgBox("Split per articolo colore", vbYesNo)
    If RES = 6 Then
        Me.IntestazioneGruppo0.ForceNewPage = 1
    Else
        Me.IntestazioneGruppo0.ForceNewPage = 0
    End If
    
End Sub

GO

-- Report_Etichette EANCodeLabelsTMP_0:3-37
/* Private Sub Corpo_Format */
Private Sub Corpo_Format(Cancel As Integer, FormatCount As Integer)
    If nomeAzienda = "Febos" Or nomeAzienda = "NewEra" Then
        Me.EtichettaBridge.Visible = False
        Me.EtichettaFebos.Visible = True
    ElseIf nomeAzienda = "bridge" Then
        Me.EtichettaBridge.Visible = True
        Me.EtichettaFebos.Visible = False
    
    Else
    
        Me.EtichettaBridge.Visible = False
        Me.EtichettaFebos.Visible = False
    End If
    If Forms!principale!FlagMostraAzienda = False Then
        Me.EtichettaBridge.Visible = False
        Me.EtichettaFebos.Visible = False
    End If

    On Error GoTo err_gest
    If Me.ControlloPercorsoImmagine <> "" Then
        Me.Fotografia.Visible = True
        Me.Fotografia.Picture = Me.ControlloPercorsoImmagine
    Else
        Me.Fotografia.Visible = False
    End If
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

GO

-- Report_Etichette EANCodeLabelsTMP_0:39-48
/* Private Sub Report_Open */
Private Sub Report_Open(Cancel As Integer)
    Dim RES As Integer
    RES = MsgBox("Split per articolo colore", vbYesNo)
    If RES = 6 Then
        Me.IntestazioneGruppo0.ForceNewPage = 1
    Else
        Me.IntestazioneGruppo0.ForceNewPage = 0
    End If
    
End Sub

GO

-- Report_Etichette EANCodeLabelsTMP:3-33
/* Private Sub Corpo_Format */
Private Sub Corpo_Format(Cancel As Integer, FormatCount As Integer)
    If Forms!principale.FlagImportatoDa = True Then
        Me.EtichettaImportatoDa.Visible = True
        Me.EtichettaDistribuitoDa.Visible = False
    
    Else
        Me.EtichettaImportatoDa.Visible = False
        Me.EtichettaDistribuitoDa.Visible = True
    End If
    If Forms!principale!FlagMostraAzienda = False Then
        Me.EtichettaImportatoDa.Visible = False
        Me.EtichettaDistribuitoDa.Visible = False
    End If

    On Error GoTo err_gest
    If Me.ControlloPercorsoImmagine <> "" Then
        Me.Fotografia.Visible = True
        Me.Fotografia.Picture = Me.ControlloPercorsoImmagine
    Else
        Me.Fotografia.Visible = False
    End If
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

GO

-- Report_Etichette EANCodeLabelsTMP:35-44
/* Private Sub Report_Open */
Private Sub Report_Open(Cancel As Integer)
    Dim RES As Integer
    RES = MsgBox("Split per articolo colore", vbYesNo)
    If RES = 6 Then
        Me.IntestazioneGruppo0.ForceNewPage = 1
    Else
        Me.IntestazioneGruppo0.ForceNewPage = 0
    End If
    
End Sub

GO

-- Report_MiglioriArticoliVenduti-LineaModello-VendutocompratoNonProiet:4-17
/* Private Sub Corpo_Format */
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

GO

-- Report_MiglioriArticoliVenduti-LineaModello:4-50
/* Private Sub Corpo_Format */
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

GO

-- Modulo1:17-23
/* Function calcoloSettimana */
Function calcoloSettimana(d As Date) As Integer
    Dim yearStartDate As Date
    yearStartDate = DateSerial(Year(d), 1, 1)
    Dim s As Integer
    s = DateDiff("w", yearStartDate, d)
    calcoloSettimana = s
End Function

GO

-- Modulo1:24-66
/* Sub salvaFileTxt */
Sub salvaFileTxt(nomefile As String, tabella As String, fieldseparator As String)
    ' apertura file di salvataggio
    Const ForReading = 1, ForWriting = 2, ForAppending = 3
    Dim fs As FileSystemObject
    Dim f As TextStream
    Set fs = CreateObject("Scripting.FileSystemObject")
    Set f = fs.CreateTextFile(nomefile, ForWriting, TristateFalse)

    Dim rst As DAO.Recordset
    Dim tmpString As String
    Set rst = CurrentDb.OpenRecordset(tabella)
    ' intestazione
    Dim numero_campi As Integer
    Dim i As Integer
    numero_campi = rst.Fields.count
    tmpString = ""
    For i = 0 To numero_campi - 1
        If tmpString <> "" Then
            tmpString = tmpString & fieldseparator & rst.Fields(i).Name
        Else
            tmpString = rst.Fields(i).Name
        End If
    Next i
    f.WriteLine tmpString
    ' contenuto tabella
    If rst.RecordCount > 0 Then
        While rst.EOF = False
            tmpString = ""
            For i = 0 To numero_campi - 1
                If tmpString <> "" Then
                    tmpString = tmpString & fieldseparator & rst.Fields(i).Value
                Else
                    tmpString = rst.Fields(i).Value
                End If
            Next i
            f.WriteLine tmpString
            
            rst.MoveNext
        Wend
    End If
    f.Close

End Sub

GO

-- Modulo1:67-176
/* Sub CreaDatiPerFatturaElCorteInglesDaDDT */
Sub CreaDatiPerFatturaElCorteInglesDaDDT(DdtNr As String)
    Dim rst As DAO.Recordset
    Dim rst_in As DAO.Recordset
    Dim rst_in2 As DAO.Recordset
    Dim rst_in3 As DAO.Recordset
    Dim rst_in4 As DAO.Recordset
    Dim rst_in5 As DAO.Recordset
    Dim rst_in6 As DAO.Recordset
    Dim SpdNr As String
    CurrentDb.Execute "Delete * from DatiElcorteIngles"
    Set rst = CurrentDb.OpenRecordset("DatiElcorteIngles")
    Dim STR As String
    ' prelievo dati da testata ddt
    STR = "select * from [ddt_picking header] where [Posted no_]='" & DdtNr & "'"
    Set rst_in = CurrentDb.OpenRecordset(STR)
    If rst_in.RecordCount > 0 Then
        SpdNr = rst_in!No_
        While rst_in.EOF = False
            'riga 1 intestazione
            rst.AddNew
            rst!campo02 = rst_in![Ship-to Name]
            rst.Update
            rst.AddNew
            rst!campo02 = rst_in![Ship-to Address]
            rst.Update
            rst.AddNew
            rst!campo02 = rst_in![Ship-to City]
            rst.Update
            rst.AddNew
            rst!campo02 = rst_in![No_]
            rst.Update
            rst.AddNew
            rst!campo02 = rst_in![posted no_]
            rst.Update
            rst.AddNew
            rst!campo02 = rst_in![posted Date]
            rst.Update
            'riga 2 salto
            rst.AddNew
            rst.Update
            ' riga 3 dati ddt
            rst.AddNew
            rst!campo02 = "No. " & rst_in![posted no_] & " of " & rst_in![posted Date]
            rst.Update
            rst_in.MoveNext
        Wend
    End If
    ' prelievo dati da righe ddt aggiunte
    STR = "select * from [ddt added line] where [document no_]='" & SpdNr & "' and [show in invoice]=1 order by [comment line no_]"
    Set rst_in = CurrentDb.OpenRecordset(STR)
    If rst_in.RecordCount > 0 Then
        While rst_in.EOF = False
            rst.AddNew
            rst!campo02 = rst_in!comment
            rst.Update
            rst_in.MoveNext
        Wend
    End If
    rst.AddNew
    rst.Update
 
    'prelievo dati da righe ddt
    STR = "select * from [ddt_picking line] where [document no_]='" & SpdNr & "' and type<>2 order by [line no_] "
    Set rst_in = CurrentDb.OpenRecordset(STR)
    If rst_in.RecordCount > 0 Then
        While rst_in.EOF = False
            ' dati da ordini
            Set rst_in2 = CurrentDb.OpenRecordset("select * from [sales line] where [document no_]='" & rst_in![Order no_] & "' and [line no_]=" & rst_in![Order line no_])
            ' dati da articoli
            Set rst_in3 = CurrentDb.OpenRecordset("select * from [item] where no_='" & rst_in!No_ & "'")
            ' dati da colori
            Set rst_in4 = CurrentDb.OpenRecordset("select * from [variable code] where [variable group]='" & rst_in![Constant Assortment Var_Grp_] & "' and [variable code]='" & rst_in![constant variable code] & "'")
            ' dati taglia min
            Set rst_in5 = CurrentDb.OpenRecordset("select * from [sales line] where [document no_]='" & rst_in![Order no_] & "' and [original line no_]=" & rst_in![Order line no_] & " order by [variable code 02] asc")
            'dati taglia max
            Set rst_in6 = CurrentDb.OpenRecordset("select * from [sales line] where [document no_]='" & rst_in![Order no_] & "' and [original line no_]=" & rst_in![Order line no_] & " order by [variable code 02] desc")
            'riga 1
            rst.AddNew
            rst!campo01 = rst_in!No_
            rst!campo02 = rst_in!Description & " " & rst_in![Description 2]
            rst!campo07 = "Ass.xCnt.: " & rst_in![assortment code] & " x " & Val(rst_in!quantity)
            rst.Update
            'riga 2
            rst.AddNew
            rst!campo01 = "Cust. Order:" & rst_in2![Customer Order ref_]
            rst!Campo04 = "Cust. Ref.:" & rst_in2![Reference]
            rst!campo07 = "Colour:" & rst_in![constant variable code] & " " & rst_in4!Description
            rst.Update
            'riga 3
            rst.AddNew
            rst!campo01 = "Tariff No.: " & rst_in3![Tariff No_]
            rst!Campo03 = "Size Det."
            rst!Campo04 = rst_in5![variable code 02] & "-" & rst_in6![variable code 02]
            rst!Campo05 = "PA"
            rst!campo06 = Val(rst_in![no_ of pairs])
            rst!campo08 = Val(rst_in2![line amount]) / Val(rst_in2![no_ of pairs])
            rst!campo09 = Val(rst_in2![line amount]) / Val(rst_in2![no_ of pairs]) * Val(rst_in![no_ of pairs])
            rst!campo10 = "0,00"
            rst!campo11 = Val(rst_in2![line amount]) / Val(rst_in2![no_ of pairs]) * Val(rst_in![no_ of pairs])
            rst.Update
                
            'riga vuota
            rst.AddNew
            rst.Update

            rst_in.MoveNext
        Wend
    End If
    rst.Close
End Sub

GO

-- Modulo1:177-189
/* Function SubstSlashDash */
Function SubstSlashDash(inpu As String) As String
    Dim p As Integer
    p = InStr(inpu, "/")
    Dim s As String
    If p > 1 Then
        s = Left$(inpu, p - 1) & "-" & Right$(inpu, Len(inpu) - p)
    Else
        s = inpu
    End If
        
    'Debug.Print s
    SubstSlashDash = s
End Function

GO

-- Modulo1:190-202
/* Function SubstSlashUndercore */
Function SubstSlashUndercore(inpu As String) As String
    Dim p As Integer
    p = InStr(inpu, "/")
    Dim s As String
    If p > 1 Then
        s = Left$(inpu, p - 1) & "_" & Right$(inpu, Len(inpu) - p)
    Else
        s = inpu
    End If
        
    'Debug.Print s
    SubstSlashUndercore = s
End Function

GO

-- Modulo1:204-322
/* Function UPC_A */
Function UPC_A(inp As String)
'Encode_UPCA

  Dim data As String
  Dim hr As Long

  'Replace "12345678" with your data field here
  data = inp

  'Set hr to 0 or 1 (1 to use long bars for the first and last charachter)
  hr = 0

  Dim Result As String
  Dim datalength As Long

  Dim barcodechar As String
  Dim barcodevalue As Long

  Dim filtereddata As String
  Dim filteredlength As Long
   
  Dim x As Long
  Dim z As Long
  Dim parity As Long
  
  Result = ""
  datalength = Len(data)
 
  'Filter Input
  For x = 1 To datalength
        barcodechar = Mid(data, x, 1)
        If AscW(barcodechar) <= AscW("9") And AscW(barcodechar) >= AscW("0") Then
            Result = Result + barcodechar
        End If
  Next x

  filtereddata = Result
  filteredlength = Len(filtereddata)
  
  

  'Encoding
  Dim transformdataleft  As String
  Dim transformdataright  As String
  Dim transformchar As Long
  Dim addcharlength As Long

  transformdataleft = ""
  transformdataright = ""

  If (filteredlength > 11) Then
      filtereddata = Left(filtereddata, 11)
  End If

  If (filteredlength < 11) Then
    
        addcharlength = 11 - Len(filtereddata)
        For x = 0 To addcharlength - 1
            filtereddata = "0" & filtereddata
        Next x
  End If


  'Check Digit
  filteredlength = Len(filtereddata)

  Dim Sumx As Long
  Dim ResultVal   As Long
  Dim cd As String
  
  
  Sumx = 0
  For x = 0 To filteredlength - 1
     barcodechar = Mid(filtereddata, x + 1, 1)
     barcodevalue = (AscW(barcodechar) - 48)

    If (x Mod 2 = 0) Then
        Sumx = Sumx + (3 * barcodevalue)
    Else
        Sumx = Sumx + barcodevalue
    End If
    
  Next x
  
  ResultVal = Sumx Mod 10
  If ResultVal = 0 Then
    ResultVal = 0
  Else
    ResultVal = 10 - ResultVal
  End If

  cd = Chr(ResultVal + AscW("0"))


  filtereddata = filtereddata + cd
  filteredlength = Len(filtereddata)


  For x = 0 To 6 - 1
        transformdataleft = transformdataleft + Mid(filtereddata, x + 1, 1)
  Next x

  For x = 6 To 12 - 1
        
        transformchar = AscW(Mid(filtereddata, x + 1, 1))
        transformchar = transformchar + 49 'Right Parity Characters transform 0 to a etc...
        transformdataright = transformdataright + Chr(transformchar)
  Next x

  If (hr = 1) Then 'make first and last digit use long bars. add 110
        Result = Chr(AscW(Mid(transformdataleft, 0 + 1, 1)) - 15) + "[" + Chr(AscW(Mid(transformdataleft, 0 + 1, 1)) + 110) + Mid(transformdataleft, 1 + 1, 5) + "-" + Mid(transformdataright, 0 + 1, 5) + Chr(AscW(Mid(transformdataright, 5 + 1, 1)) - 49 + 159) + "]" + Chr(AscW(Mid(transformdataright, 5 + 1, 1)) - 49 - 15)
  Else
        Result = "[" + transformdataleft + "-" + transformdataright + "]"
  End If


  UPC_A = Result

End Function

GO

-- Modulo1:323-336
/* Sub semplificaSQLQueries */
Sub semplificaSQLQueries()
    Dim qdf As QueryDef
    For Each qdf In CurrentDb.QueryDefs
        Dim s As String
        s = qdf.SQL
        While InStr(s, "dbo_02-Febos SRL$") <> 0
            Dim p As Integer
            p = InStr(s, "dbo_02-Febos SRL$")
            s = Left(s, p - 1) & Right(s, Len(s) - p - 16)
            Debug.Print s
        Wend
        qdf.SQL = s
    Next
End Sub

GO

-- Modulo1:338-342
/* Function restituisciDataComeStringaDaAmericana */
Function restituisciDataComeStringaDaAmericana(d As String) As Date
    Dim dTemp As String
    dTemp = Mid$(d, 4, 2) + "/" + Mid$(d, 1, 2) + "/" + Mid$(d, 7, 4)
    restituisciDataComeStringaDaAmericana = dTemp
End Function

GO

-- Modulo1:344-350
/* Function restituisciDataComeStringa */
Function restituisciDataComeStringa(d As String) As String
    Dim dTemp As String
    dTemp = d
    
    dTemp = Month(d) & "/" & Day(d) & "/" & Year(d)
    restituisciDataComeStringa = dTemp
End Function

GO

-- Modulo1:352-354
/* Sub fineProgramma */
Sub fineProgramma()
    DoCmd.Quit
End Sub

GO

-- Modulo1:356-377
/* Function append */
Function append(a As Variant, ID As String, taglio As Integer) As String
    'modifiche per gestione null; a diventa Variant anziche' string
    ' check di isnull su a

    If IsNull(a) Then a = ""
    Dim toadd
    toadd = ""
    If a <> "" Then
        If taglio = 0 Then
            toadd = "(" + a + ")"
        Else
            toadd = "(" + Left$(a, taglio) + ")"
        End If
    End If
    If memo_id = ID Then
        memo_result = memo_result & toadd
    Else
        memo_result = toadd
    End If
    memo_id = ID
    append = memo_result
End Function

GO

-- Modulo1:379-405
/* Function append_associated */
Function append_associated(a As Variant, ID As String, taglio As Integer) As String
    'modifiche per gestione null; a diventa Variant anziche' string
    ' check di isnull su a

    If IsNull(a) Or a = "" Then a = ""
    Dim toadd
    Dim beginStr As String
    toadd = ""
    If a <> "" Then
        If taglio = 0 Then
            toadd = a
        Else
            toadd = Left$(a, taglio)
        End If
    End If
    If toadd <> "" Then
        If memo_id = ID Then
            memo_result = memo_result & "," & toadd
        Else
            memo_result = toadd
        End If
    End If
    memo_id = ID
    append_associated = memo_result
    'Debug.Print a
    'Debug.Print memo_result
End Function

GO

-- Modulo1:406-572
/* Sub collegaTabelle */
Sub collegaTabelle(odbcSource As String, databaseName As String, prefixName As String)
    
'    On Error GoTo err_gest
    
    DoCmd.Hourglass True
    Dim db As Database
    Set db = CurrentDb
    Dim aTable As TableDef
    ' serve per il ricollegamento delle tabelle; in funzione dell'azienda e quindi del database cui corrisponde
    Dim odbcSourcePartenza As String
    Dim odbcSourceDestinazione As String
    ' per qualche motivo diventa difficile usare il giro su tabledefs (ne salta una su due)
    ' quindi al primo giro si esegue la rilevazione tabelle e le si salva su un vettore
    ' poi si cicla sul vettore
    Dim NomiTabelle(1 To 1000) As String
    Dim contatore As Integer
    contatore = 0
    Dim rst As DAO.Recordset
  
    Set rst = CurrentDb.OpenRecordset("TranscodificaTabelle370NewEra")
    For Each aTable In db.TableDefs
        ' MODIFICA APPOSITA PER usare solo tabelle odbc
        If (InStr(aTable.Connect, "ODBC") <> 0) Then
            contatore = contatore + 1
            NomiTabelle(contatore) = aTable.Name
            ' determinazione ridondante della odbcSourcePartenza
            odbcSourcePartenza = aTable.Connect
            ' si toglono i primi nove caratteri che corrispondono a "ODBC;DSN="
            odbcSourcePartenza = Right$(odbcSourcePartenza, Len(odbcSourcePartenza) - 9)
            ' si tiene la parte fino al successivo ;
            odbcSourcePartenza = Left$(odbcSourcePartenza, InStr(odbcSourcePartenza, ";") - 1)
            odbcSourceDestinazione = odbcSource
            ' codice usato una tantum per popolare la tabella di transcodifica nomi per NEW ERA
            'rst.AddNew
            'rst!NomeTabella370 = aTable.Name
            'rst.Update
        Else
            ' do nothing
        End If
    Next
            
    Dim i As Integer
    Dim RES As Integer
    For i = 1 To contatore
            Dim newconnect As String
            newconnect = "ODBC;DSN=" & odbcSource & ";uid=FebosStatUser;PWD=;Database=" & databaseName & " ;"
            Debug.Print NomiTabelle(i)
            ' cancella eventuali tabelle spurie
            If Left$(NomiTabelle(i), 7) = "~TMPCLP" Or Left$(NomiTabelle(i), 10) = "00000_TEST" Then
                RES = MsgBox("cancello " & NomiTabelle(i), vbYesNo)
                If RES = 6 Then
                    db.TableDefs.Delete (NomiTabelle(i))
                End If
                GoTo nextI
            End If
            ' blocco vecchio codice per saltare alcuni collegamenti su newEra
            ' salta le tabelle non collegabili su NewEra    CABLATO SU NOME DI ODBCSOURCE
            'If odbcSource = "NewEra" And (NomiTabelle(i) = "Comment Codes" Or NomiTabelle(i) = "Cross-Reference Model Item" Or NomiTabelle(i) = "Document Dimension" Or NomiTabelle(i) = "External Linked Documents" Or NomiTabelle(i) = "Item-Model Value Per Config_" Or NomiTabelle(i) = "NSP_FattureClientiAgenti" Or NomiTabelle(i) = "NSP_StoricoFattClientiAgenti" Or NomiTabelle(i) = "Posted Document Dimension" Or NomiTabelle(i) = "Sim_ Cust_ Ledger Entry" Or NomiTabelle(i) = "Sim_Detailed Cust_ Ledg_ Entry") Then
            '    MsgBox ("ByPass link su tabella " & NomiTabelle(i))
            'Else
                ' prima testa se la tabella è esistente nel nuovo database; in caso di errore si blocca (restano da cancellare le tabelle con prefisso 00000_TEST)
            '    DoCmd.TransferDatabase acLink, "Database ODBC", newconnect, acTable, prefixName & NomiTabelle(i), "00000_TEST" & NomiTabelle(i), , True
            '    db.TableDefs.Delete (NomiTabelle(i))
            '    DoCmd.TransferDatabase acLink, "Database ODBC", newconnect, acTable, prefixName & NomiTabelle(i), NomiTabelle(i), , True
                ' bisogna usare currentdb e non db altrimenti sembra non trovi la tabella... (cache??)
            '    CurrentDb.TableDefs.Delete ("00000_TEST" & NomiTabelle(i))
            'End If
                   
            Dim tabellaOrigine As String
            Dim tabellaDestinazione As String
            Dim updateProfile
            If odbcSourcePartenza = "Bridge" Or odbcSourcePartenza = "febos" Or odbcSourcePartenza = "febostestnew" Or odbcSourcePartenza = "bridgetest" Then
               If odbcSourceDestinazione = "Bridge" Or odbcSourceDestinazione = "febos" Or odbcSourceDestinazione = "febostestnew" Or odbcSourceDestinazione = "bridgetest" Then
                    'da 370 a 370
                    updateProfile = "370-370"
                ElseIf odbcSourceDestinazione = "newera" Or odbcSourceDestinazione = "neweratest" Then
                    ' da 370 a newera
                    updateProfile = "370-newera"
                Else
                    MsgBox "Impossibile trovare il profilo di conversione"
                    Exit Sub
                End If
            ElseIf odbcSourcePartenza = "newera" Or odbcSourcePartenza = "neweratest" Then
               If odbcSourceDestinazione = "Bridge" Or odbcSourceDestinazione = "febos" Or odbcSourceDestinazione = "febostestnew" Or odbcSourceDestinazione = "bridgetest" Then
                    'da newera a 370
                    updateProfile = "newera-370"
                ElseIf odbcSourceDestinazione = "newera" Or odbcSourceDestinazione = "neweratest" Then
                    ' da newera a newera
                    updateProfile = "newera-newera"
                Else
                    MsgBox "Impossibile trovare il profilo di conversione"
                    Exit Sub
                End If
            Else
                MsgBox "Impossibile trovare il profilo di conversione"
                Exit Sub
            End If
            ' nel caso di newera la ricerca va fatta dalla tabella 370 a quella nuova
            ' opposto se si deve connettere una sorgente vecchia a partire da newera
            ' AAAA MANCA DA GESTIRE NEWERA TEST
            ' RIPARTIRE DA QUI ALTRIMENTI SI SPACCA TUTTO
            ' CERCARE SE BRIDGE/BRIDGETEST/FEBOS/FEBOSTEST  NEWERA/NEWERATEST ETC ETC
            ' combinazioni da verificare se aziendaOrigine e aziendaDestinazione
            ' PER NON RISCRIVERE TUTTE LE QUERY LE TABELLE MANTENGONO I NOMI 370 ANCHE SE IN NEW ERA SONO DIVERSI
            ' QUINDI AD ESCLUSIONE DELLE TABELLE PER LE DIMENSIONI, NEL CASO DI NEW ERA SI SCEGLIE TABELLA NUOVA
            ' COLLEGANDOLA CON IL NOME VECCHIO; PER 370 NON SERVE FARE NULLA
            
            ' AAA QUI GESTIRE IL CASO DELLE TABELLE DELLE DIMENSIONI IN ECCEZIONI
            ' E VEDERE SE SI POSSONO FARE I GIOCHI DELLE TRE CARTE IN AUTOMATICO SULLE QUERY PER LA DETERMINAZIONI DELLE DIMENSIONI
            ' SUI DOCUMENTI
            'If updateProfile = "370-370" Or updateProfile = "newera-370" Then
            If updateProfile = "370-370" Then
                tabellaOrigine = NomiTabelle(i)
                tabellaDestinazione = NomiTabelle(i)
            'ElseIf updateProfile = "370-newera" Or updateProfile = "newera-newera" Then
            ElseIf updateProfile = "newera-newera" Then
                ' AAA RIPARTIRE DA QUI CHE VA IN ERRORE
                Set rst = CurrentDb.OpenRecordset("select * from TranscodificaTabelle370NewEra where nometabella370='" & NomiTabelle(i) & "'")
                If rst.RecordCount < 1 Then
                    MsgBox "Tabella di transcodifica non trovata. " & NomiTabelle(i) & ". Impossibile proseguire"
                    Exit Sub
                Else
                    rst.MoveFirst
                    tabellaOrigine = NomiTabelle(i)
                    tabellaDestinazione = rst!Nometabellanewera
                End If
            ElseIf updateProfile = "370-newera" Or updateProfile = "newera-370" Then
                MsgBox "variazione strutturale del db non consentita"
                DoCmd.Hourglass False
                Exit Sub
            Else
                MsgBox "Profilo non compatibile"
                Exit Sub
                DoCmd.Hourglass False
            End If
         
            ' se il nome destinazione è UNK vuol dire che la tabella non esiste nel NewEra --> Dimensioni
            ' quindi non si deve eseguire il rinnovo del collegamento
            ' a spin off avvenuto (vedi file note.txt) questo caso di unk non dovrebbe avvenire mai
            If tabellaDestinazione <> "UNK" Then
                DoCmd.TransferDatabase acLink, "Database ODBC", newconnect, acTable, prefixName & tabellaDestinazione, "00000_TEST" & tabellaOrigine, , True
                db.TableDefs.Delete (tabellaOrigine)
                DoCmd.TransferDatabase acLink, "Database ODBC", newconnect, acTable, prefixName & tabellaDestinazione, tabellaOrigine, , True
                ' bisogna usare currentdb e non db altrimenti sembra non trovi la tabella... (cache??)
                CurrentDb.TableDefs.Delete ("00000_TEST" & tabellaOrigine)
            Else
                MsgBox "Attenzione caso UNK non previsto. Verificare file tabelle transcodifica. orig=" & tabellaOrigine & " dest=" & tabellaDestinazione
            End If
 
nextI:
    Next
    MsgBox "done"
    GoTo fine_sub

err_gest:
    If Err = 3024 Then
        MsgBox ("ERRORE: Verificare percorso del db da collegare")
        GoTo fine_sub
    Else
        MsgBox ("ERRORE: Altro errore (" & Err & ") " & Error)
        GoTo fine_sub
    End If
fine_sub:
    db.Close
    DoCmd.Hourglass False

End Sub

GO

-- Modulo1:574-650
/* Public Function collegaTabellaLince */
Public Function collegaTabellaLince(ByVal sFileName As String, ByVal sTablename As String, _
    ByVal sRangeName As String) As Boolean
  
  Const conCannotOpen = 3432
  Const conNotRange = 3011
  Const conTableExists = 3012

  Dim db As DAO.Database
  Dim td As DAO.TableDef
  
  Dim sConnect As String
  Dim sMsg As String
  Dim sFunction As String
  
On Error GoTo HandleError
  
  collegaTabellaLince = False
  sFunction = "CollExcel"
  
  ' Controlla l'esistenza del file di Excel:
  'sFileName = CurDir() & "\" & sFileName
  
  
  If Len(Dir(sFileName)) = 0 Then
    MsgBox "Il file " & sFileName _
        & " non è stato trovato!"
    Exit Function
  End If
  Set db = CurrentDb
  
  ' Crea una nuova tabledef nel database:
  Set td = db.CreateTableDef(sTablename)
  
  ' Stringa di connessione:
  sConnect = "Excel 8.0;HDR=YES;DATABASE=" & sFileName
  td.Connect = sConnect
  
  ' Specifica il nome del range dei dati in Excel:
  td.SourceTableName = sRangeName
  
  db.TableDefs.Delete ("datiLince")
  db.TableDefs.append td
  
  'Restituisce True:
  collegaTabellaLince = True
  
ExitHere:
  
  Exit Function
  
HandleError:
  
  Select Case Err
    Case conCannotOpen
        sMsg = "Non posso aprire: " & sFileName
  
    Case conTableExists
        sMsg = "La tabella " & sTablename & _
             " esiste già."
  
    Case conNotRange
        sMsg = "Non posso trovare il range di dati: " & sRangeName & " ."
  
    Case Else
        sMsg = "Error#" & Err & ": " & Error$
  
  End Select
  
  MsgBox sMsg, vbExclamation + vbOKOnly, _
       "Errore nella Procedura: " & sFunction
  
  'Ritorna False:
  collegaTabellaLince = False
  
  Resume ExitHere
  
End Function

GO

-- Modulo1:654-735
/* Public Function ean13 */
Public Function ean13(chaine As String) As String
  'Cette fonction est regie par la Licence Generale Publique Amoindrie GNU (GNU LGPL)
  'This function is governed by the GNU Lesser General Public License (GNU LGPL)
  'V 1.1.1
  'Parametres : une chaine de 12 chiffres
  'Parameters : a 12 digits length string
  'Retour : * une chaine qui, affichee avec la police EAN13.TTF, donne le code barre
  '         * une chaine vide si parametre fourni incorrect
  'Return : * a string which give the bar code when it is dispayed with EAN13.TTF font
  '         * an empty string if the supplied parameter is no good
  Dim i%, checksum%, first%, CodeBarre$, tableA As Boolean
  ean13 = ""
  'Verifier qu'il y a 12 caracteres
  'Check for 12 characters
  If Len(chaine) = 12 Then
    'Et que ce sont bien des chiffres
    'And they are really digits
    For i% = 1 To 12
      If Asc(Mid$(chaine, i%, 1)) < 48 Or Asc(Mid$(chaine, i%, 1)) > 57 Then
        i% = 0
        Exit For
      End If
    Next
    If i% = 13 Then
      'Calcul de la cle de controle
      'Calculation of the checksum
      For i% = 12 To 1 Step -2
        checksum% = checksum% + Val(Mid$(chaine, i%, 1))
      Next
      checksum% = checksum% * 3
      For i% = 11 To 1 Step -2
        checksum% = checksum% + Val(Mid$(chaine, i%, 1))
      Next
      chaine = chaine & (10 - checksum% Mod 10) Mod 10
      'Le premier chiffre est pris tel quel, le deuxieme vient de la table A
      'The first digit is taken just as it is, the second one come from table A
      CodeBarre$ = Left$(chaine, 1) & Chr$(65 + Val(Mid$(chaine, 2, 1)))
      first% = Val(Left$(chaine, 1))
      For i% = 3 To 7
        tableA = False
         Select Case i%
         Case 3
           Select Case first%
           Case 0 To 3
             tableA = True
           End Select
         Case 4
           Select Case first%
           Case 0, 4, 7, 8
             tableA = True
           End Select
         Case 5
           Select Case first%
           Case 0, 1, 4, 5, 9
             tableA = True
           End Select
         Case 6
           Select Case first%
           Case 0, 2, 5, 6, 7
             tableA = True
           End Select
         Case 7
           Select Case first%
           Case 0, 3, 6, 8, 9
             tableA = True
           End Select
         End Select
       If tableA Then
         CodeBarre$ = CodeBarre$ & Chr$(65 + Val(Mid$(chaine, i%, 1)))
       Else
         CodeBarre$ = CodeBarre$ & Chr$(75 + Val(Mid$(chaine, i%, 1)))
       End If
     Next
      CodeBarre$ = CodeBarre$ & "*"   'Ajout separateur central / Add middle separator
      For i% = 8 To 13
        CodeBarre$ = CodeBarre$ & Chr$(97 + Val(Mid$(chaine, i%, 1)))
      Next
      CodeBarre$ = CodeBarre$ & "+"   'Ajout de la marque de fin / Add end mark
      ean13 = CodeBarre$
    End If
  End If
End Function

GO

-- Modulo1:737-746
/* Function SostituisciBarraConMeno */
Function SostituisciBarraConMeno(inp As String) As String
    Dim p As Integer
    p = InStr(inp, "/")
    While p > 0
        inp = Left$(inp, p - 1) & "-" & Right$(inp, Len(inp) - p)
        p = InStr(inp, "/")
    Wend
    SostituisciBarraConMeno = inp
        
End Function

GO

-- Modulo1:748-755
/* Function aggiungizerisucolore */
Function aggiungizerisucolore(inpu As String) As String
    Dim strTmp As String
    strTmp = inpu
    While Len(strTmp) < 3
        strTmp = "0" & strTmp
    Wend
    aggiungizerisucolore = strTmp
End Function

GO

-- Modulo1:757-793
/* Sub infotabelle */
Sub infotabelle()
    Dim tbl As TableDef
    Dim indx As Index
    Dim fld As Field
    Dim rst As DAO.Recordset
    CurrentDb.Execute ("delete from indici")
    Set rst = CurrentDb.OpenRecordset("Indici")
    For Each tbl In CurrentDb.TableDefs
        If (InStr(tbl.Connect, "ODBC") <> 0) Then
            Debug.Print tbl.Name
            rst.AddNew
            rst!tabella = tbl.Name
            rst![indice nome] = ""
            rst![indice campo] = ""
            rst.Update
            For Each fld In tbl.Fields
                rst.AddNew
                rst!tabella = tbl.Name
                rst![indice nome] = fld.Name
                rst!tipo = "campo"
                rst.Update
            Next
            For Each indx In tbl.Indexes
                Debug.Print indx.Name
                For Each fld In indx.Fields
                    rst.AddNew
                    rst!tabella = tbl.Name
                    rst![indice nome] = indx.Name
                    rst![indice campo] = fld.Name
                    rst!tipo = "indice"
                    rst.Update
                Next
            Next
        End If
    Next
    rst.Close
End Sub

GO

-- ModuloBypass:6-21
/* Sub ImpostaProprietaAvvio */
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

GO

-- ModuloBypass:23-25
/* Sub consentiBypass */
Sub consentiBypass()
    ModificaProprieta "AllowBypassKey", dbBoolean, True
End Sub

GO

-- ModuloBypass:27-51
/* Function ModificaProprieta */
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

GO

-- Report_ReportOkSovraccolli_Barcode:3-21
/* Private Sub Corpo_Format */
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

GO

-- Report_ReportOkSovraccolli_Barcode:23-35
/* Private Sub IntestazioneGruppo0_Format */
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

GO

-- Modulo2:4-33
/* Sub crea_txt_da_excel_dbgroup */
Sub crea_txt_da_excel_dbgroup()
    Dim rst As DAO.Recordset
    Dim stringa As String
    Dim stringa_1 As String
    
    Dim nome_file As String
    Set rst = CurrentDb.OpenRecordset("Spedizioni DBG")
        rst.MoveFirst
        While rst.EOF = False
            If rst!DDT <> "#N/D" Then
                Debug.Print "ddt trovato"
                ' costruzione del nome file
                nome_file = "Shipped_SPD_" & Mid$(rst![NUMERO ORDINE], 5, 2) & "_" & Mid$(rst![NUMERO ORDINE], 8, 5) & ".csv"
                Open "x:\FILE DB GROUP PROBLEMA SISTEMA\" & nome_file For Output As #1
                stringa = "Numero Ordine;Numero DDT;Data Creazione DDT;Totale Colli;Peso;Volume"
                Print #1, stringa
                stringa = rst![NUMERO ORDINE] & ";" & rst!DDT & ";"
                ' deve scambiare mese e giorno sulla data...
                stringa_1 = Format$(rst![data ddt], "mm/dd/yyyy")
                'stringa_1 = Right$(rst![data ddt], 2) & ";"
                stringa = stringa & stringa_1 & ";"
                stringa = stringa & rst!colli & ";" & rst!peso & ";" & rst!Volume
                Print #1, stringa
                Close #1
            End If
        rst.MoveNext
    Wend
    rst.Close
    MsgBox "finito"
End Sub

GO

-- Modulo2:35-84
/* Sub calcola_set */
Sub calcola_set()
    Dim rst_set As DAO.Recordset
    Dim rst_salesLines As DAO.Recordset
    Dim rst_salesOrders As DAO.Recordset
    Dim rst_result As DAO.Recordset
    Dim trovato As Integer
    Dim i As Integer
    Dim j As Integer
    Dim conta As Integer
    Dim tot_orders As Integer
    CurrentDb.Execute "Delete from combinazioni_result"
    Set rst_result = CurrentDb.OpenRecordset("combinazioni_result")
    Set rst_salesOrders = CurrentDb.OpenRecordset("Select [Sell-to customer No_] as DocNO from combinazioni_vendite group by [Sell-to customer No_]")
    If rst_salesOrders.RecordCount > 0 Then
        rst_salesOrders.MoveFirst
        rst_salesOrders.MoveLast
        j = 1
        tot_orders = rst_salesOrders.RecordCount
        rst_salesOrders.MoveFirst
        While rst_salesOrders.EOF = False
            Debug.Print rst_salesOrders!docno & " " & j & "/" & tot_orders
            For i = 1 To 84
                trovato = 0
                Set rst_set = CurrentDb.OpenRecordset("select * from Combinazioni where asset=" & i)
                rst_set.MoveLast
                If rst_set.RecordCount <> 3 Then MsgBox "errore"
                rst_set.MoveFirst
                conta = 0
                While rst_set.EOF = False
                    conta = conta + 1
                    'Debug.Print conta
                    Set rst_salesLines = CurrentDb.OpenRecordset("Select * from combinazioni_vendite where [Sell-to Customer no_]='" & rst_salesOrders!docno & "' and no_='" & rst_set!Article & "' and [Constant Variable Code]='" & rst_set!ColorCode & "'")
                    If rst_salesLines.RecordCount > 0 Then
                        trovato = trovato + 1
                    End If
                    rst_set.MoveNext
                Wend
                If trovato > 2 Then
                    rst_result.AddNew
                    rst_result![Customer no_] = rst_salesOrders!docno
                    rst_result!asset = i
                    rst_result.Update
                End If
            Next i
        rst_salesOrders.MoveNext
        j = j + 1
        Wend
    End If
    MsgBox "finito"
End Sub

GO

-- Report_MiglioriArticoliVenduti-LineaModello_MediaRisoluzione:4-50
/* Private Sub Corpo_Format */
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

GO

-- Report_Etichette EANCodeLabelsTMP_Orizz:3-33
/* Private Sub Corpo_Format */
Private Sub Corpo_Format(Cancel As Integer, FormatCount As Integer)
    If Forms!principale.FlagImportatoDa = True Then
        Me.EtichettaImportatoDa.Visible = True
        Me.EtichettaDistribuitoDa.Visible = False
    
    Else
        Me.EtichettaImportatoDa.Visible = False
        Me.EtichettaDistribuitoDa.Visible = True
    End If
    If Forms!principale!FlagMostraAzienda = False Then
        Me.EtichettaImportatoDa.Visible = False
        Me.EtichettaDistribuitoDa.Visible = False
    End If

    On Error GoTo err_gest
    If Me.ControlloPercorsoImmagine <> "" Then
        Me.Fotografia.Visible = True
        Me.Fotografia.Picture = Me.ControlloPercorsoImmagine
    Else
        Me.Fotografia.Visible = False
    End If
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

GO

-- Report_Etichette EANCodeLabelsTMP_Orizz:35-44
/* Private Sub Report_Open */
Private Sub Report_Open(Cancel As Integer)
    Dim RES As Integer
    RES = MsgBox("Split per articolo colore", vbYesNo)
    If RES = 6 Then
        Me.IntestazioneGruppo0.ForceNewPage = 1
    Else
        Me.IntestazioneGruppo0.ForceNewPage = 0
    End If
    
End Sub

GO

-- Report_Etichette EANCodeLabelsTMP_FGF:3-38
/* Private Sub Corpo_Format */
Private Sub Corpo_Format(Cancel As Integer, FormatCount As Integer)
    If Forms!principale.FlagImportatoDa = True Then
        Me.EtichettaImportatoDa.Visible = True
        Me.EtichettaDistribuitoDa.Visible = False
    
    Else
        Me.EtichettaImportatoDa.Visible = False
        Me.EtichettaDistribuitoDa.Visible = True
    End If
    If Forms!principale!FlagMostraAzienda = False Then
        Me.EtichettaImportatoDa.Visible = False
        Me.EtichettaDistribuitoDa.Visible = False
    End If

    On Error GoTo err_gest
    If Me.ControlloPercorsoImmagine <> "" Then
        Me.Fotografia.Visible = True
        Me.Fotografia.Picture = Me.ControlloPercorsoImmagine
    Else
        Me.Fotografia.Visible = False
    End If
    
    ' forza sempre a non visibile la foto e nemmeno importato da e distribuito da
    Me.EtichettaImportatoDa.Visible = False
    Me.EtichettaDistribuitoDa.Visible = False
    Me.Fotografia.Visible = False
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

GO

-- Report_Etichette EANCodeLabelsTMP_FGF:40-49
/* Private Sub Report_Open */
Private Sub Report_Open(Cancel As Integer)
    Dim RES As Integer
    RES = MsgBox("Split per articolo colore", vbYesNo)
    If RES = 6 Then
        Me.IntestazioneGruppo0.ForceNewPage = 1
    Else
        Me.IntestazioneGruppo0.ForceNewPage = 0
    End If
    
End Sub

GO

-- Report_Etichette EANCodeLabelsTMP_QuelloGiusto:3-16
/* Private Sub Corpo_Format */
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

GO

-- Report_Etichette EANCodeLabelsTMP_QuelloGiusto:18-27
/* Private Sub Report_Open */
Private Sub Report_Open(Cancel As Integer)
    Dim RES As Integer
    RES = MsgBox("Split per articolo colore", vbYesNo)
    If RES = 6 Then
        Me.IntestazioneGruppo0.ForceNewPage = 1
    Else
        Me.IntestazioneGruppo0.ForceNewPage = 0
    End If
    
End Sub

GO

