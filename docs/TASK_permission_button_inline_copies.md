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
