# TASK — Schemi di input inline nei router verso `@luke/core`

Aperto il 2026-08-29, a valle della migrazione dialog→form.

## Contesto

La regola 7 di CLAUDE.md dice: *«se esiste in `@luke/core`, importalo da lì»*. Non dice cosa fare
quando **non** esiste ancora, ed è lì che nasce la deriva: chi scrive un endpoint definisce lo schema
inline, e chi scrive il form corrispondente riscrive le stesse regole a mano.

Durante la migrazione ne abbiamo estratti tre — `feedback.submit`, `system.triggerCalendarDigest`,
`holidays.upsertVendorClosure` — ma **tutti e tre per caso**: sono emersi solo perché bloccavano un
form che stavamo toccando. Nessuno ha mai guardato gli altri.

Il costo non è estetico. Su `upsertVendorClosure` il form validava `z.string().date()` mentre il
server voleva `datetime()`, e nessuno se n'era accorto: due definizioni della stessa cosa divergono
in silenzio finché qualcuno non incontra il caso limite.

## Misura (2026-08-29)

`.input(z.object(` compare **106 volte in 22 router**:

```
seasonCalendar 26 · collectionLayout 10 · holidays 9 · company 8
integrations.nav 7 · phaseAlert 5 · merchandisingPlan 5 · dashboard 5
planningGroup 4 · phase 4 · collectionCatalog 4 · phaseHistory 3
notifications 3 · pricing 2 · me 2 · integrations.google 2
collectionLayoutRevision 2 · users.admin 1 · sectionAccess 1
integrations 1 · integrations.ldap 1 · auth 1
```

Comando per rifare la misura:

```bash
grep -rc "\.input(z\.object(" apps/api/src/routers/*.ts | grep -v ":0" | sort -t: -k2 -rn
```

## Criterio di selezione — la parte che conta

**Non vanno spostati tutti.** Un filtro di lista usato da un solo endpoint sta benissimo dov'è, e
spostarlo aggiunge un'indirezione senza comprare niente.

Va in core quando **il frontend riscrive la stessa regola a mano**. Era vero su tutti e tre i casi
già estratti. È il criterio che rende il lavoro finito e misurabile invece che infinito.

Come trovarli: per ogni router con schema inline, cercare in `apps/web/src` una validazione Zod (o un
controllo manuale equivalente) sugli stessi campi. I candidati più probabili sono gli endpoint che
alimentano un form — quindi i router con dialog corrispondenti, non quelli di sola lettura o export.

Secondo criterio, più debole ma utile: uno schema riusato da **più di un endpoint** merita un nome
anche se il frontend non lo tocca.

## Piano

1. **Censimento mirato**, non totale: per i router che alimentano form, elencare gli input inline e
   accanto la validazione corrispondente lato web. Solo le coppie che esistono davvero entrano
   nello scope. Attenzione: il censimento va fatto guardando i file, non con un `grep -c` — vedi la
   voce «A grep is evidence about text» in `lessons.md`.
2. **Batch da ≤3 router**, ognuno: schema in `packages/core/src/schemas/<dominio>.ts`, `.input()`
   del router aggiornato, form che importa da core, riga `@input {...}` del JSDoc allineata.
3. **Ogni commit verde**: `pnpm --filter @luke/core build` prima del typecheck di api e web,
   altrimenti `apps/web` non vede la nuova forma.
4. A fine lavoro valutare se serve un vincolo. Probabilmente **no**: «schema inline» non è di per sé
   sbagliato, quindi una regola avrebbe troppi falsi positivi. Vale la stessa logica per cui
   l'audit sulle cache è finito con `@luke/no-raw-query-client` invece che con un test scanner.

## Verifica

```bash
pnpm --filter @luke/core build && pnpm --filter @luke/core test
cd apps/api && npx tsc -b && npx eslint src/ && pnpm test:integration:local
cd apps/web && npx tsc --noEmit && npx eslint src/ && npx vitest run
```

Il segnale che l'estrazione è servita: il form e il router rifiutano lo **stesso** input con lo
**stesso** messaggio. Se dopo lo spostamento i due divergono ancora, lo schema è stato copiato, non
condiviso.

## Fuori scope — il seam che questo lavoro non raggiunge (aperto il 2026-08-30, da B1)

Condividere lo schema **allo strato del dialog** chiude la distanza fra il campo e l'endpoint solo
finché il payload inviato coincide con l'insieme dei campi validati. Dove non coincide, l'estrazione
non serve a niente e non se ne accorge nessuno, perché il tipo continua a tornare.

Due casi trovati durante B1, entrambi su collection layout:

- `CollectionRowDrawer.tsx` attacca `quotations` e `phaseChangeNote` al payload **dopo** che
  `form.handleSubmit` ha girato. Sono tipati `CollectionLayoutRowInput` ma non passano mai da
  `parse`: `phaseChangeNote.max(500)`, `retailPrice.positive()` e `sku.int().min(1)` — tutti già in
  core — lato client non li applica nessuno.
- `ChangePhaseDialog.tsx` raccoglie la sua nota senza schema e senza `maxLength`: 501 caratteri
  vengono accettati, bufferizzati, e rifiutati solo quando fallisce il salvataggio dell'intera riga.

Stessa forma del difetto che il task descrive — due idee divergenti di cosa sia valido — ma un
livello sotto, e il rimedio è diverso: non «sposta lo schema in core» (lì c'è già) bensì **valida il
payload assemblato**, non solo i campi del form. Non va in nessuno dei batch da ≤3 router: è un
lavoro sui call site, da fare a parte una volta chiuso lo spostamento degli schemi.

Nota collegata, stessa origine: `MandatoryReasonSchema` (`packages/core/src/schemas/reason.ts`,
estratto in B1) esiste perché la regola «motivazione obbligatoria, 1-500, trimmata» era dichiarata
sei volte fra `collectionLayout` e `seasonCalendar`. L'ordine `.trim()` prima di `.min(1)` non è
cosmetico: al contrario il trim non tocca il controllo e una nota di soli spazi passa il form per
farsi rifiutare dal server. `packages/core/src/schemas/vendor.ts` ha ancora l'ordine inerte.

## B5 — i finding rinviati (aperto il 2026-08-30)

Roba emersa durante il censimento e durante B1/B2 che **non** è «schema inline da spostare in
core», e che per questo non entra in nessun batch da ≤3 router — ma che è lo stesso difetto di
fondo, una regola dichiarata più volte che diverge in silenzio. Va fatta, in fondo, come batch a sé.

1. **Policy password: sei definizioni hardcoded, una configurabile che ne governa una sola.** Le
   cinque chiavi `security.password.*` esistono nel registry e sono lette da `getPasswordPolicy`,
   ma `validatePassword` ha **un solo call site** (`auth.service.ts`, la conferma reset). Gli altri
   percorsi — `users.core.create`, `users.core.update`, `me.changePassword` — portano la loro copia
   della regola, e così `UserForm` (due volte, create e edit, con regole diverse fra loro) e
   `usePasswordValidation`. Alzi `minLength` a 16 e la creazione utente accetta ancora 12; abbassi
   `requireSpecialChar` e il cambio password self-service continua a rifiutare. Fallisce aperto in
   una direzione e chiuso nell'altra.
   **Deciso**: AppConfig diventa autoritativa su tutti i percorsi; lo Zod scende a `min(8)` (il
   floor a cui `getPasswordPolicy` già clampa) come prefiltro; una query espone la policy al client
   così che form e indicatori smettano di riscriverla. Comporta che rilassare la policy rilassa
   anche `me.changePassword`, e che la policy diventa leggibile dal client (serve sulla pagina di
   reset, senza sessione).

2. **Parametri argon2 inline invece di `ARGON2_OPTIONS`.** `users.core.router.ts` e
   `auth.service.ts` costruiscono l'oggetto a mano; `backup/crypto.ts` fa la cosa giusta e lo
   spreada. I valori oggi coincidono, quindi non si rompe niente: il punto è che un ritocco di
   tuning lascerebbe indietro due percorsi senza che nessuno se ne accorga, perché hash con
   parametri diversi continuano a verificarsi correttamente. Due righe, passano da `hashPassword()`.

3. **`ProfileTab` riscrive i vincoli come attributo HTML.** `maxLength={200}` dove core dice
   `footerText: z.string().max(200)`, più `{5}` e `{7}` senza controparte. Il tab non ha form
   schema, è tutto `useState`. Minore e di natura diversa — l'attributo tronca, non rifiuta — ma è
   la stessa costante scritta due volte.

4. **La copertura che questo task ha scoperto di non avere.** Più volte abbiamo condiviso uno
   schema senza poter dimostrare niente, perché sotto non c'era un test. Due punti, entrambi
   emersi mentre si spostava lo schema, nessuno dei due causato da noi:

   - `rescheduleMilestone` e `cancelMilestone` (B2) non hanno test, né prima né dopo.
     `test/procedure-coverage.ts` dichiara 28 procedure scoperte su `seasonCalendar` con la
     motivazione giusta («la copertura va costruita per milestone, non in un colpo»), quindi il
     gate resta verde — ma i cambi di B2 (rifiuto >500 lato client, motivazione trimmata a valle)
     sono esattamente le cose che un test dovrebbe fissare. Servono fixture calendario + planning
     group + evento, e alla fine `uncovered` va portato a 26.
   - `UserForm` (B3) non ha test e ha un solo caller, `UserDialog`, che fa passthrough. Il
     typecheck copre la shape, non il comportamento: che create e edit accettino e rifiutino le
     stesse identità, che `confirmPassword` non finisca mai nel payload, che in edit una password
     vuota significhi «lascia quella che c'è» e non «svuotala». Sono tre asserzioni su un
     componente che gestisce credenziali, e oggi non ne esiste nessuna. Da fare comunque, ma
     soprattutto **prima** di toccare le regole password al punto 1: quel cambio senza rete sotto
     è il modo più facile per rompere la creazione utente in silenzio.
