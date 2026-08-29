# TASK — Copie inline di `PermissionButton` e tooltip irraggiungibili da tastiera

Aperto il 2026-08-29. **Dei tre task nati da quella sessione, questo è l'unico con una conseguenza
visibile per l'utente.**

## Contesto

`components/PermissionButton.tsx` incapsula il pattern prescritto da CLAUDE.md per un controllo
senza permesso: bottone disabilitato, `opacity-50 cursor-not-allowed`, e un tooltip che spiega
perché. Il suo JSDoc documenta il dettaglio non ovvio:

> *Un `<button disabled>` non emette `pointerenter` né `focus` [...] il bottone appariva grigio e il
> messaggio che spiega il blocco non compariva a nessuno. Gli eventi passano attraverso il bottone e
> li raccoglie lo span; `tabIndex={0}` lo rende raggiungibile da tastiera, dove un bottone
> disabilitato non arriva.*

Qualcuno ha già sbattuto contro questo problema e l'ha risolto **una volta**. Quattro file lo
reimplementano a mano, e nel farlo hanno perso proprio il pezzo che il commento spiega.

## Misura (2026-08-29)

Wrapper `TooltipTrigger asChild` inline attorno a un controllo disabilitato, e quanti portano
`tabIndex`:

| file | trigger | con `tabIndex` |
|---|---|---|
| `admin/phase-catalog/page.tsx` | 4 | **0** |
| `admin/collection-layout-configuration/page.tsx` | 4 | **0** |
| `product/collection-layout/_components/CollectionGroupSection.tsx` | 9 | 1 |
| `product/pricing/_components/ParameterSetPanel.tsx` | 3 | 1 |

**20 wrapper, 2 con `tabIndex`.** Gli altri 18 hanno un tooltip che chi naviga da tastiera non può
raggiungere: il bottone è disabilitato e quindi non focalizzabile, e senza `tabIndex={0}` sullo span
non c'è nessun altro modo di arrivarci. Il controllo è grigio e la spiegazione non esiste — cioè
esattamente lo scenario che `PermissionButton` è stato scritto per chiudere.

Comando per rifare la misura:

```bash
for f in <i quattro file>; do
  echo "$f  trigger=$(grep -c 'TooltipTrigger asChild' "$f")  tab=$(grep -A1 'TooltipTrigger asChild' "$f" | grep -c tabIndex)"
done
```

Attenzione a non ricontare male: `cursor-not-allowed` compare 31 volte in `apps/web/src`, ma **13
sono la classe disabled standard di shadcn** (primitives in `components/ui/` e input nativi) e non
c'entrano niente con i permessi. La misura utile è quella sui wrapper, non sulla classe CSS.

## Perché non è solo duplicazione

Il comportamento col mouse è corretto in tutti e quattro i file: il tooltip appare. Il difetto
riguarda la tastiera, quindi non si vede provando l'app col trackpad — ed è il motivo per cui è
sopravvissuto.

`PermissionButton` ha **30 call site** e funziona. Qui non serve inventare niente: serve usarlo.

## Piano

1. **Verificare caso per caso se `PermissionButton` è applicabile.** Avvolge un `Button`. Dove il
   controllo disabilitato è un `DropdownMenuItem` o un elemento diverso, non lo è: quei casi vanno
   o lasciati con un `tabIndex={0}` aggiunto a mano, o serve un secondo componente
   (`PermissionMenuItem`) — decisione da prendere dopo aver contato quanti sono, non prima.
2. **Batch da un file per volta**, partendo dai due admin (4 wrapper ciascuno, tutti senza
   `tabIndex`): sono i più uniformi e quelli con il difetto pieno.
3. `CollectionGroupSection` per ultimo: 9 wrapper, uno dei quali già corretto — quindi lì convivono
   due varianti e va guardato con più attenzione.
4. **Chiudere con un vincolo**, se dopo la migrazione i casi residui sono zero: una regola che
   rifiuti un `TooltipTrigger asChild` il cui figlio contiene un elemento `disabled` senza
   `tabIndex`. Se invece restano eccezioni legittime, **non** scrivere la regola — vale lo stesso
   criterio applicato all'audit sulle cache: si vieta la via di fuga solo quando non ha falsi
   positivi.

## Verifica

Il test vero è da tastiera, non da mouse: `Tab` fino al controllo disabilitato, e il tooltip deve
comparire. Se il focus lo salta, il difetto è ancora lì.

`npx eslint src/` e `npx tsc --noEmit` non dicono nulla su questo — è precisamente il tipo di
difetto che passa tutti i controlli automatici e si vede solo esercitando l'interazione.

---

## Esito (2026-08-29)

**La misura sopra sovrastima il difetto.** Contava le occorrenze grezze di
`TooltipTrigger asChild`, non i wrapper attorno a un controllo *disabilitato*. Dei 20 trigger, 10
stanno su controlli abilitati (drag handle, "Aggiungi riga", "Elimina variante", indice di riga):
il bottone è focalizzabile da sé, nessun difetto da tastiera. I difettosi erano **8**, tutti nei
due file admin. `CollectionGroupSection` (step 3 del piano) non aveva lavoro dentro: il suo unico
wrapper permission-disabled era già quello corretto.

Fatto:

- **8 wrapper → `PermissionButton`** nei due file admin.
  `disabled={!canWrite || isMutating}` → `hasPermission={canWrite}` + `disabled={isMutating}`;
  la guardia ridondante `canWrite &&` nell'`onClick` è caduta (il componente disabilita già).
  −162/+84 righe, import `Tooltip*` rimossi da entrambi.
- **Frecce di riordino in `phase-catalog`**: difetto peggiore trovato lì accanto —
  `disabled={!canWrite || …}` e *nessun* tooltip, quindi grigio senza spiegazione per chiunque,
  mouse incluso. Anch'esse su `PermissionButton`.
- **`ParameterSetPanel`**: i due bottoni con `disabled={isLoading}` avevano lo stesso difetto in
  forma transitoria — irraggiungibili proprio nella finestra in cui l'utente si chiede perché non
  rispondono. Trigger spostato su uno span con `tabIndex={isLoading ? 0 : -1}`: la tab stop esiste
  solo mentre il bottone è disabilitato, altrimenti raddoppierebbe quella del bottone.
- **Regola ESLint `@luke/no-unreachable-disabled-tooltip`** (step 4): rifiuta un
  `TooltipTrigger asChild` il cui sottoalbero contiene un elemento `disabled` se il figlio del
  trigger non porta `tabIndex`, e rifiuta sempre un trigger che è *esso stesso* disabilitato
  (lì `tabIndex` non basta: un elemento disabilitato non diventa focalizzabile). Copre anche il
  `disabled` dinamico. Attiva su `apps/web/src/**` in `eslint.config.mjs`.

I due wrapper inline superstiti (`CollectionGroupSection.tsx`, `ParameterSetPanel.tsx`) restano
inline di proposito e passano la regola: il loro ramo abilitato ha un tooltip *informativo* su un
bottone-icona ("Elimina", "Elimina variante"), che `PermissionButton` non sa esprimere — mostra un
tooltip solo quando il permesso manca.

`npx eslint apps/web/src` e `npx tsc --noEmit` puliti. **Resta da fare la verifica da tastiera**:
`Tab` fino a un controllo disabilitato nelle due pagine admin, il tooltip deve comparire.

### Verifica da tastiera (fatta)

Provata sull'app in esecuzione con un utente senza `collection_layout:update` /
`pricing:create`: `Tab` atterra sullo `span.inline-flex[tabindex=0]` e il `[role="tooltip"]`
compare. Confermato su `/product/pricing` e `/product/collection-layout`.

**Non** sulle due pagine admin migrate: l'utente di prova non ha section access ad `admin.*` e
viene rediretto a `/dashboard`. Renderizzano attraverso lo stesso `PermissionButton` appena
verificato, ma per vederle serve un account con accesso alla sezione admin e senza permesso di
scrittura.

### Difetto complementare: tooltip assente

Guardando l'app con l'utente viewer è emerso lo stesso problema in forma opposta —
non "tooltip irraggiungibile" ma *nessun tooltip*: controlli `disabled` su una variabile di
permesso e basta, grigi senza spiegazione per chiunque, mouse incluso.
Trovati e sistemati con `PermissionButton`:

- frecce di riordino in `admin/phase-catalog` (vedi sopra);
- "Copia da stagione precedente" e "Crea layout vuoto" in `EmptyCollectionLayoutState`.

I toggle gender nello stesso file non sono `Button` ma `<button>` nativi, quindi
`PermissionButton` non li avvolge. È il caso previsto dallo step 1 del piano: serviva il secondo
componente. `components/PermissionTooltip.tsx` — stesso span con `tabIndex={0}` come trigger, ma
attorno a figli qualsiasi e senza imporre lo stile disabled, che lì è già nel `className` del
bottone. Avvolge **il gruppo intero**, non i tre toggle uno per uno: sono disabilitati per la
stessa identica ragione, e una tab stop con un messaggio batte lo stesso messaggio ripetuto tre
volte. Verificato da tastiera: il focus prende il gruppo, il tooltip compare, il layout non si
muove.

Lasciati di proposito, con un commento che dice perché: i tre `!canUpdate` dentro il dialog di
copia — il dialog si apre solo dal bottone ora gated, quindi sono difesa in profondità su uno
stato irraggiungibile.

La regola ESLint **non** copre questa famiglia: senza `TooltipTrigger` non c'è niente da
controllare. Servirebbe una regola diversa ("un `disabled` che dipende da una variabile di
permesso deve stare dentro `PermissionButton` o avere un tooltip"), più invasiva e con falsi
positivi — non scritta.
