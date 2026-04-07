SELECT [ConfrontoGiacenzaLogimoda-step1].CAT, [ConfrontoGiacenzaLogimoda-step1].Marchio_, [ConfrontoGiacenzaLogimoda-step1].Stagione_, [ConfrontoGiacenzaLogimoda-step1].Articolo_, Item.[Description 2], [ConfrontoGiacenzaLogimoda-step1].Colore_, [ConfrontoGiacenzaLogimoda-step1].Assortimento, [ConfrontoGiacenzaLogimoda-step1].qty, [ConfrontoGiacenzaLogimoda-step1].pairs, [ConfrontoGiacenzaLogimoda-step1].Location_
FROM [ConfrontoGiacenzaLogimoda-step1] INNER JOIN Item ON [ConfrontoGiacenzaLogimoda-step1].Articolo_ = Item.No_;

