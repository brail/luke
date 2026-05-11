SELECT CodiceCliente, Commento, ordinamentocommento
FROM NoteOrdiniVenditaDaClienti

UNION ALL SELECT CodiceCliente, Commento, ordinamentocommento
FROM NoteOrdiniVenditaDaOrdini;

