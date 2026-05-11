INSERT INTO [KIMO-FASHION Item] ( [Item No_], [Insert DateTime], [Original Item No_], [Original Model Item No_], Status, Prebuy, [Model Item No_], [Color Code], [Size Code], [Configurator Relation], [Selling Season Code] )
SELECT KimoProva.[Nr# articolo], KimoProva.[DataOra inserimento], KimoProva.[Nr# articolo originale], KimoProva.[Cod# art# modello originale], KimoProva.Stato, KimoProva.Prebuy, KimoProva.[Cod# art# modello], KimoProva.[Cod# colore], KimoProva.[Cod# taglia], KimoProva.[Relazione configuratore], "" AS Espr1
FROM KimoProva;

