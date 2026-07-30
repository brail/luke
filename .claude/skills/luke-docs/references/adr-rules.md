# luke-docs — Regole ADR (modalità `adr`) <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
Directory: `docs/decisions/` (formato MADR). Lingua: **italiano**. <!-- skill-check-ignore -->
La skill modifica **solo il campo Status**. Contesto, Decisione e Conseguenze sono sempre manuali. <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
## Formato MADR (obbligatorio) <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
```markdown <!-- skill-check-ignore -->
# NNNN — Titolo della decisione <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
## Status <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
Accepted <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
## Contesto <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
Perché questa decisione era necessaria. Vincoli, forze in gioco, alternative considerate. <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
## Decisione <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
Cosa abbiamo scelto e perché. <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
## Conseguenze <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
Trade-off introdotti, vincoli architetturali, impatti su altri componenti. <!-- skill-check-ignore -->
``` <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
Valori ammessi per `Status`: <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
- `Accepted` — decisione attiva e validata <!-- skill-check-ignore -->
- `Deprecated` — non più applicabile, sostituita da prassi diverse <!-- skill-check-ignore -->
- `Superseded by [NNNN — Titolo](NNNN-titolo.md)` — rimpiazzata da un ADR successivo <!-- skill-check-ignore -->
- `Potentially stale — review needed` — la skill ha rilevato una potenziale contraddizione con la codebase <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
--- <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
## Validazione contro codebase <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
Per ogni ADR con `Status: Accepted`, verifica le affermazioni chiave cercando evidenza nel codice. <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
**Strategia di ricerca per tipo di affermazione:** <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
| Tipo di affermazione | Come verificare | <!-- skill-check-ignore -->
|---------------------|----------------| <!-- skill-check-ignore -->
| "Usiamo libreria X" | Cerca `X` in `package.json` dei workspace rilevanti | <!-- skill-check-ignore -->
| "Non usiamo Y" | Cerca `Y` in tutti i `package.json` — assenza = confermato | <!-- skill-check-ignore -->
| "Il modello si chiama Z" | Cerca `model Z` in `schema.prisma` | <!-- skill-check-ignore -->
| "La funzione F esiste in package P" | Cerca `export` + nome in `packages/P/src/` | <!-- skill-check-ignore -->
| "Il pattern/flag/config C è attivo" | Cerca in `CLAUDE.md`, `lessons.md`, file di config rilevanti | <!-- skill-check-ignore -->
| "Il campo status ammette valori V" | Cerca enum corrispondente in `schema.prisma` o `packages/core` | <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
**Esito per ogni ADR:** <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
| Evidenza trovata | Azione | <!-- skill-check-ignore -->
|-----------------|--------| <!-- skill-check-ignore -->
| Confermata — codice coerente con decisione | Lascia `Status: Accepted` invariato | <!-- skill-check-ignore -->
| Contraddizione rilevata — codice diverge | Imposta `Status: Potentially stale — review needed`, segnala nel report con dettaglio | <!-- skill-check-ignore -->
| Non verificabile — affermazione troppo astratta | Lascia invariato, segnala come "non verificabile automaticamente" nel report | <!-- skill-check-ignore -->
| ADR già `Deprecated` o `Superseded` | Salta la validazione, includi solo nell'indice | <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
**Non marcare mai un ADR come stale se la contraddizione è ambigua** — solo quando c'è <!-- skill-check-ignore -->
evidenza esplicita (es. package rimosso, model rinominato, pattern abbandonato). <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
--- <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
## Indice `docs/decisions/README.md` <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
Sempre completamente rigenerato, ordine numerico crescente: <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
```markdown <!-- skill-check-ignore -->
# Decisioni architetturali <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
<!-- luke-docs:start:adr-index --> <!-- skill-check-ignore -->
| # | Titolo | Status | <!-- skill-check-ignore -->
|---|--------|--------| <!-- skill-check-ignore -->
| [0001](0001-titolo.md) | Titolo della decisione | Accepted | <!-- skill-check-ignore -->
| [0002](0002-titolo.md) | Titolo della decisione | Deprecated | <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
*Ultimo aggiornamento: {data corrente}* <!-- skill-check-ignore -->
<!-- luke-docs:end:adr-index --> <!-- skill-check-ignore -->
``` <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
--- <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
## Checklist qualità ADR (verifica prima di chiudere) <!-- skill-check-ignore -->
 <!-- skill-check-ignore -->
- [ ] Nessun ADR ha Contesto / Decisione / Conseguenze modificati <!-- skill-check-ignore -->
- [ ] Solo il campo `Status` è stato toccato dove necessario <!-- skill-check-ignore -->
- [ ] Ogni `Potentially stale` nel report ha un dettaglio specifico (cosa contraddice cosa) <!-- skill-check-ignore -->
- [ ] L'indice `docs/decisions/README.md` include tutti i file presenti nella directory <!-- skill-check-ignore -->
- [ ] Nessun ADR è stato marcato stale per ambiguità — solo per evidenza esplicita <!-- skill-check-ignore -->
