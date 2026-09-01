# TASK — Rendere effettivo il controllo sugli URL hardcoded

Aperto il 2026-08-29.

## Contesto

CLAUDE.md prescrive: mai `localhost:3001` in `apps/web/src`, sempre `buildApiUrl()` /
`buildTrpcUrl()` dal barrel `@luke/core` (all'apertura del task la regola indicava il
sotto-path `@luke/core/net/url`: non è più un specifier importabile da quando il package
è ESM-only ed espone solo `.`, `./server` e `./utils/date`). E dichiara già il buco, con
parole sue:

> *manual check: `pnpm codemod:check-urls` — not yet an ESLint rule in
> `packages/eslint-plugin-luke/`, nor wired into CI/husky*

Verificato il 2026-08-29: lo script **esiste** in `package.json:29` e **non compare in nessun
workflow né in nessun hook husky**.

```bash
grep -rn "codemod:check-urls" package.json .github/workflows/ .husky/
# → solo package.json
```

Un controllo che nessuno lancia non è un controllo. È la lezione centrale della sessione da cui
nasce questo task: la migrazione dialog→form ha funzionato perché è finita con una **regola**, non
con un rapporto; e la regola, lanciata sui file già sistemati, ha trovato un caso che il censimento
manuale aveva mancato.

## Due strade

**A — Agganciarlo alla CI così com'è.** Dieci minuti. Aggiungere uno step al job lint di
`.github/workflows/ci.yml`. Costo quasi nullo, ma il difetto lo scopri a PR aperta, non mentre
scrivi, e lo script gira su tutto il repo a ogni push.

**B — Convertirlo in regola ESLint** in `packages/eslint-plugin-luke/`, sul modello di
`no-dialog-input-outside-form` e `no-raw-query-client`. Mezza giornata. Diventa un errore
nell'editor, gira solo sui file toccati, e il messaggio può indicare la funzione da usare al posto
dell'URL letterale.

**Consigliata: B**, con A come ponte se serve copertura subito. Il precedente di questa sessione è
netto — la regola ESLint ha trovato un file che il censimento manuale non vedeva, perché la
proprietà è strutturale e un `grep` risponde su testo.

Prima di scegliere B, però: leggere `tools/codemods/eliminate-hardcoded-urls.ts` e capire cosa
riconosce davvero. Se fa analisi che una regola ESLint non replica facilmente (per esempio
riscrittura automatica), la strada giusta potrebbe essere A più un `--fix` manuale, non la
riscrittura.

## Verifica

Qualunque strada, il criterio è lo stesso usato per le altre due regole: **dimostrare che morde.**
Reintrodurre di proposito un `localhost:3001` in un file di `apps/web/src`, verificare che il
controllo fallisca nominando file e riga, rimuoverlo.

Un controllo che passa sempre e uno che non gira sono indistinguibili dall'esterno: la prova va
fatta, non dedotta.
