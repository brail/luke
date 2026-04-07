SELECT "FATT" AS DocType, No_, [Bill-to Customer No_], [Bill-to Name], [Posting Date], [Shortcut Dimension 1 Code], [Selling Season Code], [Shortcut Dimension 2 Code], [Subject 1], [Subject 2], [Salesperson Code], [Area Manager Code], ProvvigioneSogg1, ProvvigioneSogg2, ProvvigioneAgente, ProvvigioneAreamanager
FROM SoggettiProvvigionaliFatture

UNION ALL SELECT "NDC" AS DocType, No_, [Bill-to Customer No_], [Bill-to Name], [Posting Date], [Shortcut Dimension 1 Code], [Selling Season Code], [Shortcut Dimension 2 Code], [Subject 1], [Subject 2], [Salesperson Code], [Area Manager Code], ProvvigioneSogg1, ProvvigioneSogg2, ProvvigioneAgente, ProvvigioneAreamanager
FROM SoggettiProvvigionaliNoteDiCredito;

