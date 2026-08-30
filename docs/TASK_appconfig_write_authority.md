# TASK — Allowlist che gateano dati persistiti, applicate solo in lettura

Aperto il 2026-08-30, a valle di B5 (`TASK_router_schemas_to_core.md`) e del /simplify su di esso.

> **Stato al 2026-08-30.** Punti 1, 2 e 3 chiusi. Punto 4 (`SAFE_KEY_LIST`) non iniziato:
> richiede un censimento che va condotto a parte, ed è deliberatamente tenuto in un diff
> separato da quello sull'autorità in scrittura. Punto 5 resta una domanda aperta.
> Dettagli in fondo, sezione «Esito».

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

---

## Esito

### Punto 3 — chiuso prima degli altri, e in modo più ampio

Il commit `780660c` ha tolto `config:read`/`config:update` a **editor e viewer**, invece di gateare
il solo prefisso `security.` su `*:*` come proponeva il piano. Il gate sul prefisso avrebbe chiuso
la policy password e lasciato aperti gli altri 26 endpoint dietro `config:update` — SMTP, LDAP,
`auth.strategy`, le credenziali OAuth Google e S3 — di cui uno solo controllava anche la section
access. La regressione da B5 era il sintomo; la causa era che RBAC concedeva più di quanto
`SECTION_ACCESS_DEFAULTS` lasciasse intendere.

### Punti 1 e 2 — la scrittura risponde al registry

- `saveConfig(prisma, key: AppConfigKey, value, encrypt)` — la chiave è tipizzata. Le 44 chiavi
  scritte con literal erano già tutte nel registry: `tsc` è passato senza modifiche ai call site.
- `saveConfig` valida il valore con `validateConfigValue(key, raw)` **prima** di cifrare. Il caso
  speciale su `security.password.minLength` in `upsertConfig` è sparito come conseguenza.
- Le due chiavi costruite dinamicamente erano `storage.smb` e `storage.drive`. Sono **entrate** nel
  registry: `storage.${provider}` si restringe da solo perché `provider` è un enum a due valori, e
  i loro schemi Zod si sono spostati dal router a `packages/core/src/storage/config.ts`.
- `validateKey` nel router config narrowa a `AppConfigKey`, ma **in aggiunta** a `ALLOWED_PREFIXES`,
  non al suo posto: i due gate rispondono a domande diverse, e appoggiarsi al solo registry avrebbe
  aperto `backup.*`, `rbac.*`, `auditLog.*` e `rateLimit` all'endpoint generico `config.set`.

**`importJson`** — decisione risolta senza scrivere codice. Il ciclo aveva già un try/catch per
item con `errorCount`/`errors[]`: un `saveConfig` che lancia produce «salta la chiave e la riporta»
gratis, e il contratto dell'endpoint non cambia. Un backup con un valore non più valido si
ripristina lo stesso, meno quella chiave, che viene nominata nella risposta.

**Valori cifrati** — verificato: nessuno schema del registry descrive un ciphertext. La validazione
gira sul chiaro, prima di `encryptValue`. Validare dopo avrebbe testato un blob esadecimale contro
una regola scritta per il segreto (`min(1)` sarebbe passato sempre).

### Due cose che il piano non aveva previsto

**1. Quattro call site scrivevano `''` per dire «non configurato».**
`integrations.google.oauth.refreshToken`, `…oauth.userEmail`, `…impersonateEmail`,
`storage.s3.publicBaseUrl` — tutti contro schemi (`.email()`, `.url()`, `.min(1)`) che la stringa
vuota non soddisfa. Non è stato allargato lo schema: i call site ora **cancellano la chiave**.
`getConfig` restituisce già `null` per una chiave assente, quindi `''` era un secondo modo di dire
quello che `null` diceva già, e ogni reader futuro avrebbe dovuto *sapere* che `''` significa unset.
`deleteConfig` è diventato idempotente (`deleteMany`) e resta su `key: string`: una delete non può
persistere un valore sbagliato, e pretendere l'appartenenza al registry lascerebbe senza rimozione
una riga la cui chiave venisse tolta dal registry in futuro.

**2. Nove chiavi sfuggivano a `safeParse`.** Le entry shape
`z.string().transform(s => Schema.parse(JSON.parse(s)))` — `rateLimit`, `app.sections.disabled`,
`maintenance.mode.state`, `rbac.sectionAccessDefaults` e altre — **lanciano** attraverso
`safeParse` invece di popolare `result.error`: un `parse` dentro un `transform` non viene raccolto.
Senza intervento la validazione in scrittura avrebbe funzionato solo per le chiavi scalari, e ogni
blob JSON malformato sarebbe uscito come `SyntaxError` (500) invece che come `BAD_REQUEST`.
Trovato da un test, non a lettura.

La prima stesura ci metteva un try/catch dentro `validateConfigValue`. Il /simplify l'ha
correttamente bocciato come toppa al chiamante: «`safeParse` non lancia mai» è un contratto che
ogni entry del registry deve onorare, non un problema del consumatore. Le nove entry usano ora
`jsonConfigSchema(Inner)`, dichiarato accanto a `booleanConfigSchema` — stesso identico movimento
che quel helper aveva già fatto per i booleani — che riporta un JSON malformato via `ctx.addIssue`
e poi `.pipe(Inner)`. `validateConfigValue` è tornato a essere un wrapper sottile senza catch, e la
proprietà è pinnata con un `it.each` su **tutte** le chiavi del registry: è ciò che intercetta la
decima chiave JSON scritta nel modo ovvio.

### Verifica

`packages/core` 225/225 · `apps/api` unit 432/432 · `apps/api` integration 510/510 (+1 expected
fail) con il gate procedure-coverage verde · `apps/web` 80/80 · lint e typecheck puliti sui tre
pacchetti.

Il segnale del piano — «cambiare il tipo di una chiave nel registry deve rompere la compilazione al
call site che la scrive» — è pinnato in `apps/api/test/configWriteAuthority.types.spec.ts`, dentro
`tsconfig.test.json`: le asserzioni sono i `@ts-expect-error`, che falliscono `tsc` se l'errore che
si aspettano smette di succedere. Il resto sta in `configWriteAuthority.integration.spec.ts`.

Cinque test d'integrazione preesistenti scrivevano chiavi inventate (`app.test`, `app.test0`,
`app.test.secret`) per collaudare idempotenza, rate limit e audit: puntano ora a chiavi reali del
registry. Erano esattamente il drift che il gate esiste per fermare.
