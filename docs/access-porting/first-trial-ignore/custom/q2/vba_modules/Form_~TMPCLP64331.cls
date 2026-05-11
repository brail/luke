Option Compare Database

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