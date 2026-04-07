Option Compare Database

Option Explicit
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
