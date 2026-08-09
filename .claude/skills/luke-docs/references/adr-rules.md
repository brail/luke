# luke-docs — Regole ADR (modalità `adr`)

Directory: `docs/decisions/` (formato MADR). Lingua: **italiano**.
La skill modifica **solo il campo Status**. Contesto, Decisione e Conseguenze sono sempre manuali.

## Formato MADR (obbligatorio)

```markdown
# NNNN — Titolo della decisione

## Status

Accepted

## Contesto

Perché questa decisione era necessaria. Vincoli, forze in gioco, alternative considerate.

## Decisione

Cosa abbiamo scelto e perché.

## Conseguenze

Trade-off introdotti, vincoli architetturali, impatti su altri componenti.
```

Valori ammessi per `Status`:

- `Accepted` — decisione attiva e validata
- `Deprecated` — non più applicabile, sostituita da prassi diverse
- `Superseded by [NNNN — Titolo](NNNN-titolo.md)` — rimpiazzata da un ADR successivo
- `Potentially stale — review needed` — la skill ha rilevato una potenziale contraddizione con la codebase

---

## Validazione contro codebase

Per ogni ADR con `Status: Accepted`, verifica le affermazioni chiave cercando evidenza nel codice.

**Strategia di ricerca per tipo di affermazione:**

| Tipo di affermazione                | Come verificare                                                |
| ----------------------------------- | -------------------------------------------------------------- |
| "Usiamo libreria X"                 | Cerca `X` in `package.json` dei workspace rilevanti            |
| "Non usiamo Y"                      | Cerca `Y` in tutti i `package.json` — assenza = confermato     |
| "Il modello si chiama Z"            | Cerca `model Z` in `schema.prisma`                             |
| "La funzione F esiste in package P" | Cerca `export` + nome in `packages/<P>/src/`                   |
| "Il pattern/flag/config C è attivo" | Cerca in `CLAUDE.md`, `lessons.md`, file di config rilevanti   |
| "Il campo status ammette valori V"  | Cerca enum corrispondente in `schema.prisma` o `packages/core` |

**Esito per ogni ADR:**

| Evidenza trovata                                | Azione                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| Confermata — codice coerente con decisione      | Lascia `Status: Accepted` invariato                                                   |
| Contraddizione rilevata — codice diverge        | Imposta `Status: Potentially stale — review needed`, segnala nel report con dettaglio |
| Non verificabile — affermazione troppo astratta | Lascia invariato, segnala come "non verificabile automaticamente" nel report          |
| ADR già `Deprecated` o `Superseded`             | Salta la validazione, includi solo nell'indice                                        |

**Non marcare mai un ADR come stale se la contraddizione è ambigua** — solo quando c'è
evidenza esplicita (es. package rimosso, model rinominato, pattern abbandonato).

---

## Indice `docs/decisions/README.md`

Sempre completamente rigenerato, ordine numerico crescente:

```markdown
# Decisioni architetturali

<!-- luke-docs:start:adr-index -->

| #                      | Titolo                 | Status     |
| ---------------------- | ---------------------- | ---------- |
| [0001](0001-titolo.md) | Titolo della decisione | Accepted   |
| [0002](0002-titolo.md) | Titolo della decisione | Deprecated |

_Ultimo aggiornamento: {data corrente}_

<!-- luke-docs:end:adr-index -->
```

---

## Checklist qualità ADR (verifica prima di chiudere)

- [ ] Nessun ADR ha Contesto / Decisione / Conseguenze modificati
- [ ] Solo il campo `Status` è stato toccato dove necessario
- [ ] Ogni `Potentially stale` nel report ha un dettaglio specifico (cosa contraddice cosa)
- [ ] L'indice `docs/decisions/README.md` include tutti i file presenti nella directory
- [ ] Nessun ADR è stato marcato stale per ambiguità — solo per evidenza esplicita
