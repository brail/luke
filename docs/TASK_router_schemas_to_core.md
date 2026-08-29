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
