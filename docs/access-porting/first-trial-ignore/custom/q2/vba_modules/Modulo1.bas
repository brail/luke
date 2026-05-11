Option Compare Database

Option Explicit



' QUI SI TROVANO SUB E FUNZIONI DI SUPPORTO ALLE VARIE OPERAZIONI DELL'APPLICAZIONE



Global Const dbg = False

Global livelloUtente As Integer

Global nomeUtente As String

Global nomeAzienda As String



Global Const SapDataCheckFolder = "\\donald\Febos\SapCheck\"

Global Const EDICheckFolder = "\\donald\Febos\EdiCheck\"



Dim memo_id As String

Dim memo_result As String



Function calcoloSettimana(d As Date) As Integer

    Dim yearStartDate As Date

    yearStartDate = DateSerial(Year(d), 1, 1)

    Dim s As Integer

    s = DateDiff("w", yearStartDate, d)

    calcoloSettimana = s

End Function

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

  Dim z As LongPWD=

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



Function restituisciDataComeStringaDaAmericana(d As String) As Date

    Dim dTemp As String

    dTemp = Mid$(d, 4, 2) + "/" + Mid$(d, 1, 2) + "/" + Mid$(d, 7, 4)

    restituisciDataComeStringaDaAmericana = dTemp

End Function



Function restituisciDataComeStringa(d As String) As String

    Dim dTemp As String

    dTemp = d

    

    dTemp = Month(d) & "/" & Day(d) & "/" & Year(d)

    restituisciDataComeStringa = dTemp

End Function



Sub fineProgramma()

    DoCmd.Quit

End Sub



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

            newconnect = "ODBC;DSN=" & odbcSource & ";uid=FebosStatUser;pwd=StatUserFebos!;Database=" & databaseName & " ;"

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



Function SostituisciBarraConMeno(inp As String) As String

    Dim p As Integer

    p = InStr(inp, "/")

    While p > 0

        inp = Left$(inp, p - 1) & "-" & Right$(inp, Len(inp) - p)

        p = InStr(inp, "/")

    Wend

    SostituisciBarraConMeno = inp

        

End Function



Function aggiungizerisucolore(inpu As String) As String

    Dim strTmp As String

    strTmp = inpu

    While Len(strTmp) < 3

        strTmp = "0" & strTmp

    Wend

    aggiungizerisucolore = strTmp

End Function



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



