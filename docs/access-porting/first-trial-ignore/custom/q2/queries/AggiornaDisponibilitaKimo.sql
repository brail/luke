UPDATE DisponibilitaDaAggiornare INNER JOIN [KIMO-FSH Item Availability] ON DisponibilitaDaAggiornare.[Nr# Articolo] = [KIMO-FSH Item Availability].[Item No_] SET [KIMO-FSH Item Availability].Availability = [vendita limitata], [KIMO-FSH Item Availability].Quantity = [quantità], [KIMO-FSH Item Availability].[Location Code] = "PMAG";

