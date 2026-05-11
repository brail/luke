SELECT [FE Header].DenominazioneF, [FE Header].NomeF, [FE Header].CognomeF, Vendor.Name, [FE Header].[Document No_]
FROM [FE Header] LEFT JOIN ([Purch_ Inv_ Header] LEFT JOIN Vendor ON [Purch_ Inv_ Header].[Buy-from Vendor No_] = Vendor.No_) ON [FE Header].[Document No_] = [Purch_ Inv_ Header].No_;

