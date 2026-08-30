# TASK — Allowlist che gateano dati persistiti, applicate solo in lettura

Aperto il 2026-08-30, a valle di B5 (`TASK_router_schemas_to_core.md`) e del /simplify su di esso.

## Contesto

La regola 15 di CLAUDE.md dice che ogni lista mantenuta a mano che filtra dati persistiti va legata
a un tipo, «così che un call site fuori dalla lista fallisca `tsc` invece di derivare». Due liste
importanti non lo sono, e per la stessa ragione: **sono applicate solo sul lato lettura**.

Le due sembrano problemi distinti. Non lo sono: in entrambi i casi esiste una dichiarazione
autorevole, esiste un meccanismo che la applica, e il meccanismo non copre il percorso da cui i
dati entrano.

### AppConfigRegistry

93 chiavi dichiarate con il loro schema Zod. Quante sono davvero governate da quello schema:

| percorso | chiavi | schema applicato |
|---|---|---|
| lettura via `getTypedConfig` | **12** | sì |
| lettura via `getConfig` (stringa grezza, parsing a mano al call site) | il resto | no |
| scrittura via `upsertConfig` (`config.set/update/setMultiple/importJson`) | tutte | **no** |
| scrittura via `saveConfig` diretta (51 chiamate in 9 file) | 44 | **no** |

`saveConfig(prisma, key: string, value: string)` — la chiave è una `string` qualsiasi. La lettura ha
una variante tipizzata (`getTypedConfig<K extends AppConfigKey>`), la scrittura non ne ha nessuna.

L'unica validazione in scrittura che esiste è un `if (key === 'security.password.minLength')`
scritto a mano dentro `upsertConfig`: la validazione generale, approssimata per l'unica chiave in
cui qualcuno ne ha sentito il bisogno.

**Conseguenza già misurata, non ipotetica.** Il /simplify su B5 ha trovato che un utente con ruolo
**editor** può abbassare la policy password a «otto caratteri qualsiasi»: `config:update` è nei
permessi di editor, `security` è fra i prefissi ammessi, e nessuna guardia copre i quattro toggle.
Prima di B5 non era possibile — i percorsi avevano pavimenti statici in Zod che nessuna
configurazione poteva abbassare. B5 li ha tolti di proposito, rendendo la configurazione
autoritativa su quattro percorsi invece di uno, senza accorgersi che quella configurazione è
scrivibile un ruolo sotto admin. È una regressione introdotta da B5.

### SAFE_KEY_LIST

`AuditMetadata = Partial<Record<AuditMetadataKey, unknown>>` esiste perché una chiave non elencata
fallisca la build. Ma il controllo sulle proprietà in eccesso di TypeScript vale **solo per
proprietà scritte letteralmente**. Ogni altra forma sfugge:

| forma | dove | controllo |
|---|---|---|
| `metadata: syncResult` | `routers/seasonCalendar.ts` (`triggerSync`) | nessuno |
| `metadata: safeMetadata` | `lib/auditMiddleware.ts` | nessuno |
| `metadata: { ...input }` | `routers/maintenance.backup.router.ts` | nessuno — spreda un intero input tRPC |
| `{ ...baseMeta, … }` | stesso file | solo sulle chiavi letterali |
| `...(cond && {…})` | `routers/seasonCalendar.ts` ×3 | solo sulle letterali |

Una chiave che sfugge non dà errore: il sanitizer la scrive `[REDACTED]`. È il fallimento chiuso e
silenzioso della regola 15 — nessuno se ne accorge finché non legge l'audit mesi dopo. B5 ne ha
trovate due così (`oldAllDay`/`newAllDay`) e le ha aggiunte alla lista, che è la toppa, non il fix.

## Perché non si chiude con i tipi

Per `SAFE_KEY_LIST` non esiste una soluzione di tipo: TypeScript non estende l'excess-property check
attraverso gli spread, e non c'è modo di forzarlo. Per il registry una soluzione di tipo esiste ed è
metà del lavoro, ma non copre i valori.

Quindi servono due meccanismi diversi, ed è la ragione per cui questo è un task e non una patch.

## Piano

### 1. Legare la scrittura di config al registry — il tipo

`saveConfig` e `upsertConfig` accettano `AppConfigKey` invece di `string`. Compile-time, gratis,
chiude i refusi. Oggi non romperebbe niente: ho verificato che tutte e 44 le chiavi scritte con
literal esistono già nel registry. Le chiavi costruite dinamicamente (`storage.${provider}` in
`integrations.storage.router.ts`) vanno guardate una per una — se non sono nel registry, o ci
entrano o dichiarano esplicitamente di starne fuori.

### 2. Validare i valori in scrittura

`saveConfig` fa `AppConfigRegistry[key].safeParse(value)` prima di scrivere. Gli schemi accettano
già stringhe in ingresso (`z.coerce.*`, `.transform(JSON.parse)`), che è la forma in cui i valori
arrivano. Il caso speciale su `minLength` sparisce come conseguenza, non per scelta.

Due decisioni da prendere prima di scrivere codice:

- **Valori cifrati**: `saveConfig` cifra dopo; la validazione va fatta sul chiaro. Verificare che
  nessuno schema del registry si aspetti il testo cifrato.
- **`importJson`**: un backup che contiene un valore non più valido — si rifiuta l'import intero, si
  salta la chiave, o si importa e si lascia fallire la lettura? Oggi passa senza guardare. È la
  decisione più delicata perché tocca il ripristino.

### 3. Chiudere la regressione su `security.password.*`

Indipendente da 1 e 2, e più urgente: `upsertConfig` gatea il prefisso `security.` su `*:*`.
Precedente nel progetto: `pricing:update` è deliberatamente escluso dal ruolo editor. Va fatto
**prima**, perché è una regressione di sicurezza viva.

### 4. `SAFE_KEY_LIST`: un controllo a runtime che fallisce forte fuori produzione

L'unico meccanismo che vede anche gli spread e le variabili nude. In `logAudit`: se una chiave non è
nella lista, in `NODE_ENV !== 'production'` si lancia, in produzione si continua a redigere come
oggi. Zero cambio di comportamento in prod, e la CI diventa il gate.

Ordine obbligato, perché il primo passo è un censimento:

1. modalità sola-segnalazione, si gira l'intera suite di integrazione, si raccoglie l'elenco delle
   violazioni esistenti (`metadata: { ...input }` sul backup router ne produrrà parecchie);
2. si sistemano: o la chiave entra nella lista come decisione deliberata, o smette di essere passata;
3. si passa al lancio.

Da valutare in aggiunta, non in alternativa: una regola ESLint che imponga a `metadata:` di essere
un oggetto letterale, così il feedback arriva nell'editor invece che al run dei test. È il pattern
di casa per questa classe — l'audit sulle cache è finito con `@luke/no-raw-query-client`. Non
sostituisce il controllo a runtime, che è l'unico a vedere `metadata: syncResult`.

### 5. La domanda che resta aperta

93 chiavi nel registry, 12 lette attraverso il suo schema. Le altre passano da `getConfig` e vengono
interpretate a mano a ogni call site — `?.value === 'true'` in quattro file diversi, per dirne una.
Il /simplify ha misurato che si possono riportare 11 chiavi booleane alla semantica precedente senza
che un solo test diventi rosso.

Non entra in questo task, ma va detto: finché la lettura tipizzata copre 12 chiavi su 93, «il
registry è la fonte di verità» descrive un'intenzione, non il codice.

## Verifica

```bash
pnpm --filter @luke/core build && pnpm --filter @luke/core test
cd apps/api && npx tsc -b && npx eslint src/ test/ && pnpm test:integration:local
cd apps/web && npx tsc --noEmit && npx eslint src/ && npx vitest run
```

Il segnale che il punto 4 è servito: rimettere `metadata: { ...input }` da qualche parte fa fallire
la suite invece di scrivere `[REDACTED]` in silenzio. Per i punti 1-2: cambiare il tipo di una
chiave nel registry deve rompere la compilazione al call site che la scrive, non alla prima lettura
in produzione.
