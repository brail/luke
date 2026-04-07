SELECT NSP_Subject1, NSP_Subject2, [Document No_], [Season Code], [Trademark Code], "INVOICE" AS TipoDoc
FROM [ControlloSoggettiRoyalties-step1-Fatture];

UNION ALL SELECT NSP_Subject1, NSP_Subject2, [Document No_], [Season Code], [Trademark Code], "CREDIT NOTE" AS TipoDoc
FROM [ControlloSoggettiRoyalties-step2-NoteCredito];

